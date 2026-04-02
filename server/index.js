require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const Document = require('./models/Document');
const dns = require("dns") 
dns.setServers([
  '1.1.1.1',
  '8.8.8.8'
])

const app = express();
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173'
}));
app.use(express.json());
app.get('/', (req, res) => res.send('CollabDocs server is running!'))
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// All document tracking at top level
const documentUsers = {};
const documentVersions = {};
const documentDeltas = {};
const lastSavedContent = {};

async function findOrCreateDocument(id) {
  if (!id) return null;
  const existing = await Document.findById(id);
  if (existing) return existing;
  return await Document.create({ _id: id, data: {}, revisions: [] });
}

app.get('/documents/:id/revisions', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc.revisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('get-document', async ({ documentId, user }) => {
    try {
      const document = await findOrCreateDocument(documentId);
      socket.join(documentId);
      socket.documentId = documentId;
      socket.user = user;

      if (!documentUsers[documentId]) documentUsers[documentId] = {};
      documentUsers[documentId][socket.id] = { ...user, id: socket.id };

      socket.emit('load-document', document.data);

      setTimeout(() => {
        io.to(documentId).emit('users-update', Object.values(documentUsers[documentId]));
      }, 100);

      console.log(`Room ${documentId.slice(0,8)} now has ${Object.keys(documentUsers[documentId]).length} users`);
    } catch (err) {
      console.error('Error loading document:', err);
    }
  });

  // OT: version tracking + conflict detection
  socket.on('send-changes', ({ delta, version }) => {
    if (!socket.documentId) return;
    const docId = socket.documentId;

    if (!documentVersions[docId]) documentVersions[docId] = 0;
    if (!documentDeltas[docId]) documentDeltas[docId] = [];

    const serverVersion = documentVersions[docId];
    let conflictResolved = false;

    if (version < serverVersion) {
      conflictResolved = true;
    }

    documentVersions[docId]++;
    documentDeltas[docId].push(delta);
    if (documentDeltas[docId].length > 100) {
      documentDeltas[docId] = documentDeltas[docId].slice(-100);
    }

    socket.broadcast.to(docId).emit('receive-changes', {
      delta,
      version: documentVersions[docId],
      conflictResolved
    });

    socket.emit('change-confirmed', {
      version: documentVersions[docId],
      conflictResolved
    });
  });

  // Cursor tracking
  socket.on('cursor-move', (cursorData) => {
    if (!socket.documentId) return;
    socket.broadcast.to(socket.documentId).emit('cursor-update', {
      ...cursorData,
      userId: socket.id,
      user: socket.user
    });
  });

  // Typing indicator
  socket.on('typing', ({ isTyping }) => {
    if (!socket.documentId) return;
    socket.broadcast.to(socket.documentId).emit('user-typing', {
      userId: socket.id,
      name: socket.user?.name || 'Someone',
      color: socket.user?.color || '#888',
      isTyping
    });
  });

  // Save document — only new revision if content changed
  socket.on('save-document', async (data) => {
    if (!socket.documentId) return;
    try {
      const contentStr = JSON.stringify(data);
      const lastStr = lastSavedContent[socket.documentId];

      const updateObj = lastStr === contentStr
        ? { data }
        : {
            data,
            $push: {
              revisions: {
                $each: [{ data, savedAt: new Date() }],
                $slice: -20
              }
            }
          };

      await Document.findByIdAndUpdate(
        socket.documentId,
        updateObj,
        { returnDocument: 'after', upsert: true }
      );

      lastSavedContent[socket.documentId] = contentStr;
    } catch (err) {
      console.error('Save error:', err);
    }
  });

  socket.on('disconnect', () => {
    const docId = socket.documentId;
    if (docId && documentUsers[docId]) {
      delete documentUsers[docId][socket.id];
      io.to(docId).emit('users-update', Object.values(documentUsers[docId]));
      io.to(docId).emit('cursor-remove', socket.id);
      io.to(docId).emit('user-typing', {
        userId: socket.id,
        isTyping: false
      });
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));