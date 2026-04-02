 
# CollabDocs — Real-time Collaborative Text Editor

A Google Docs-style collaborative editor where multiple users can edit the same document simultaneously with real-time sync, conflict resolution, and revision history.

## Features

- Real-time text synchronisation across multiple users
- Operational Transformation (OT) for conflict resolution
- Colored cursors with user name labels per user
- User presence indicators showing who is online
- Typing indicators — shows when someone is typing
- Bold, italic, underline text formatting
- Document persistence with MongoDB
- Revision history with restore functionality
- Shareable document links

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Real-time | Socket.io (WebSocket) |
| Editor | Quill.js |
| Backend | Node.js + Express |
| Database | MongoDB Atlas + Mongoose |
| Conflict Resolution | Operational Transformation (OT) |

## Setup Instructions

### Prerequisites
- Node.js installed
- MongoDB Atlas account

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/collab-editor.git
cd collab-editor
```

### 2. Setup the server
```bash
cd server
npm install
```

Create a `.env` file inside the `server` folder:
```
MONGODB_URI=your_mongodb_connection_string
PORT=3001
```

Start the server:
```bash
npm start
```

### 3. Setup the client
```bash
cd ../client
npm install
npm run dev
```

### 4. Open the app
Go to `http://localhost:5173` in your browser.
To test collaboration, open the same URL in two browser tabs.

## How It Works

### Real-time Sync
Every keystroke is converted to a Quill Delta operation and sent via Socket.io to the server, which broadcasts it to all other users in the same document room.

### Conflict Resolution (OT)
The server tracks a version number for each document. When two users edit simultaneously, the server detects version mismatches and flags conflicts. The "⚡ Conflict resolved" badge appears when this happens.

### Cursor Tracking
Each user gets a unique color. Their cursor position is broadcast to all other users and displayed as a colored line with a name label.

### Revision History
The document is auto-saved every 2 seconds. A new revision is only created when content actually changes, preventing duplicate entries.

