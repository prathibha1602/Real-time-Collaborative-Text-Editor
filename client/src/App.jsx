import { useEffect, useRef, useState, useCallback } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import { io } from 'socket.io-client'
import { v4 as uuidv4 } from 'uuid'
import './App.css'

const SAVE_INTERVAL_MS = 2000
const TOOLBAR_OPTIONS = [
  ['bold', 'italic', 'underline'],
  [{ header: [1, 2, 3, false] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['clean']
]

const USER_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22']
const myId = uuidv4()
const colorIndex = parseInt(myId.replace(/-/g, '').slice(0, 8), 16) % USER_COLORS.length
const myColor = USER_COLORS[colorIndex]
const myName = `User-${Math.floor(Math.random() * 1000)}`

function getDocumentId() {
  const path = window.location.pathname.slice(1)
  if (path) return path
  const newId = uuidv4()
  window.location.replace(`/${newId}`)
  return newId
}

export default function App() {
  const [socket, setSocket] = useState(null)
  const [quill, setQuill] = useState(null)
  const [users, setUsers] = useState([])
  const [revisions, setRevisions] = useState([])
  const [showRevisions, setShowRevisions] = useState(false)
  const [status, setStatus] = useState('Connecting...')
  const [typingUsers, setTypingUsers] = useState({})
  const [conflictFlash, setConflictFlash] = useState(false)
  

  const versionRef = useRef(0)
  const cursorsRef = useRef({})
  const cursorOverlayRef = useRef(null)
  const typingTimerRef = useRef(null)
  const isTypingRef = useRef(false)
  const documentId = useRef(getDocumentId()).current
  const [docTitle, setDocTitle] = useState('Untitled Document')
  const [copied, setCopied] = useState(false)

  // Socket setup
  useEffect(() => {
    const s = io('https://real-time-collaborative-text-editor-production.up.railway.app')
    setSocket(s)
    s.on('connect', () => setStatus('Connected'))
    s.on('disconnect', () => setStatus('Disconnected'))
    return () => s.disconnect()
  }, [])

  // Quill setup
  const wrapperRef = useCallback((wrapper) => {
    if (!wrapper) return
    wrapper.innerHTML = ''
    const editor = document.createElement('div')
    wrapper.append(editor)
    const q = new Quill(editor, {
      theme: 'snow',
      modules: { toolbar: TOOLBAR_OPTIONS }
    })
    q.disable()
    q.setText('Loading document...')
    setQuill(q)
  }, [])

  // Join document room
  useEffect(() => {
    if (!socket || !quill) return
    socket.emit('get-document', {
      documentId,
      user: { name: myName, color: myColor, id: myId }
    })
    socket.on('load-document', (data) => {
      quill.setContents(data)
      quill.enable()
      setStatus('Ready')
    })
  }, [socket, quill, documentId])

  // Receive remote OT changes
  useEffect(() => {
    if (!socket || !quill) return

    const handler = ({ delta, version, conflictResolved }) => {
      quill.updateContents(delta)
      versionRef.current = version
      if (conflictResolved) {
        setConflictFlash(true)
        setTimeout(() => setConflictFlash(false), 2000)
      }
    }

    const confirmHandler = ({ version, conflictResolved }) => {
      versionRef.current = version
      if (conflictResolved) {
        setConflictFlash(true)
        setTimeout(() => setConflictFlash(false), 2000)
      }
    }

    socket.on('receive-changes', handler)
    socket.on('change-confirmed', confirmHandler)
    return () => {
      socket.off('receive-changes', handler)
      socket.off('change-confirmed', confirmHandler)
    }
  }, [socket, quill])

  // Send local OT changes + cursor + typing
  useEffect(() => {
    if (!socket || !quill) return
    const handler = (delta, oldDelta, source) => {
      if (source !== 'user') return

      socket.emit('send-changes', {
        delta,
        version: versionRef.current
      })

      const range = quill.getSelection()
      if (range) {
        socket.emit('cursor-move', {
          index: range.index,
          length: range.length,
          color: myColor,
          name: myName
        })
      }

      if (!isTypingRef.current) {
        isTypingRef.current = true
        socket.emit('typing', { isTyping: true })
      }
      clearTimeout(typingTimerRef.current)
      typingTimerRef.current = setTimeout(() => {
        isTypingRef.current = false
        socket.emit('typing', { isTyping: false })
      }, 1500)
    }
    quill.on('text-change', handler)
    return () => {
      quill.off('text-change', handler)
      clearTimeout(typingTimerRef.current)
    }
  }, [socket, quill])

  // Auto-save
  useEffect(() => {
    if (!socket || !quill) return
    const interval = setInterval(() => {
      socket.emit('save-document', quill.getContents())
    }, SAVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [socket, quill])

  // Fix 1 — Remote cursors with correct user color
  useEffect(() => {
    if (!socket || !quill) return

    const editorContainer = quill.root.parentElement
    let overlay = cursorOverlayRef.current

    if (!overlay) {
      overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:absolute',
        'top:0',
        'left:0',
        'width:100%',
        'height:100%',
        'pointer-events:none',
        'z-index:10',
        'overflow:hidden'
      ].join(';')
      editorContainer.style.position = 'relative'
      editorContainer.appendChild(overlay)
      cursorOverlayRef.current = overlay
    }

    const handleCursorUpdate = ({ userId, index, length, color, name, user }) => {
      // Fix: always use color from cursorData first, then user object
      const cursorColor = color || user?.color || '#888'
      const cursorName = name || user?.name || 'User'

      if (cursorsRef.current[userId]) {
        cursorsRef.current[userId].remove()
        delete cursorsRef.current[userId]
      }

      let bounds
      try {
        bounds = quill.getBounds(index, length)
      } catch {
        return
      }
      if (!bounds) return

      const cursor = document.createElement('div')
      cursor.style.cssText = [
        'position:absolute',
        `left:${bounds.left}px`,
        `top:${bounds.top}px`,
        `height:${bounds.height || 18}px`,
        'width:2px',
        `background:${cursorColor}`,
        'pointer-events:none',
        'border-radius:1px',
        'transition:left 0.1s, top 0.1s'
      ].join(';')

      const label = document.createElement('div')
      label.textContent = cursorName
      label.style.cssText = [
        'position:absolute',
        'top:-20px',
        'left:0',
        `background:${cursorColor}`,
        'color:#fff',
        'padding:2px 6px',
        'border-radius:4px',
        'font-size:11px',
        'font-weight:600',
        'white-space:nowrap',
        'line-height:1.4',
        'pointer-events:none'
      ].join(';')

      cursor.appendChild(label)
      overlay.appendChild(cursor)
      cursorsRef.current[userId] = cursor
    }

    const handleCursorRemove = (userId) => {
      if (cursorsRef.current[userId]) {
        cursorsRef.current[userId].remove()
        delete cursorsRef.current[userId]
      }
    }

    socket.on('cursor-update', handleCursorUpdate)
    socket.on('cursor-remove', handleCursorRemove)
    return () => {
      socket.off('cursor-update', handleCursorUpdate)
      socket.off('cursor-remove', handleCursorRemove)
    }
  }, [socket, quill])

  // User presence
  useEffect(() => {
    if (!socket) return
    socket.on('users-update', (userList) => setUsers(userList))
    return () => socket.off('users-update')
  }, [socket])

  // Typing indicators
  useEffect(() => {
    if (!socket) return
    const handler = ({ userId, name, color, isTyping }) => {
      setTypingUsers(prev => {
        const updated = { ...prev }
        if (isTyping) {
          updated[userId] = { name, color }
        } else {
          delete updated[userId]
        }
        return updated
      })
    }
    socket.on('user-typing', handler)
    return () => socket.off('user-typing', handler)
  }, [socket])

  // Fix 2 — Load revision history with error handling
  const loadRevisions = async () => {
    try {
      const res = await fetch(`https://real-time-collaborative-text-editor-production.up.railway.app/documents/${documentId}/revisions`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      const seen = new Set()
      const deduped = data.reverse().filter(rev => {
        const key = new Date(rev.savedAt).toISOString().slice(0, 16)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      setRevisions(deduped)
      setShowRevisions(true)
    } catch (err) {
      console.error('Failed to load revisions:', err)
      setRevisions([])
      setShowRevisions(true)
    }
  }

  const restoreRevision = (data) => {
    if (!quill) return
    quill.setContents(data)
    socket.emit('save-document', data)
    setShowRevisions(false)
  }

  // Fix 3 — Close history panel
  const closeRevisions = () => {
    setShowRevisions(false)
  }

  const typingList = Object.values(typingUsers)
  const typingText = typingList.length === 1
    ? `${typingList[0].name} is typing...`
    : typingList.length === 2
    ? `${typingList[0].name} and ${typingList[1].name} are typing...`
    : typingList.length > 2
    ? 'Several people are typing...'
    : ''

  return (
    <div className="app">
      <header className="toolbar-header">
        <div className="logo">📝 CollabDocs</div>
<input
  className="doc-title-input"
  value={docTitle}
  onChange={(e) => setDocTitle(e.target.value)}
  placeholder="Untitled Document"
  maxLength={60}
/>
        <div className="doc-id">
          Doc: <code>{documentId.slice(0, 8)}…</code>
          <button
  onClick={() => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }}
  className="copy-btn"
>
  {copied ? '✓ Copied!' : 'Share Link'}
</button>
        </div>

        <div className="users-bar">
          {users.map(u => (
            <div
              key={u.id}
              className="user-chip"
              style={{ background: u.color }}
              title={u.name}
            >
              {u.name.slice(0, 2).toUpperCase()}
            </div>
          ))}
        </div>

        <div className={`status-dot ${status === 'Ready' || status === 'Connected' ? 'online' : 'offline'}`}>
          {status}
        </div>

        {conflictFlash && (
          <div className="conflict-badge">
            ⚡ Conflict resolved
          </div>
        )}

        <button className="rev-btn" onClick={loadRevisions}>History</button>
      </header>

      {typingText && (
        <div className="typing-bar">
          <span className="typing-dots">
            <span /><span /><span />
          </span>
          {typingText}
        </div>
      )}

      <div className="editor-container" ref={wrapperRef} />

      {/* Fix 3 — History panel with working close button */}
      {showRevisions && (
        <div className="revisions-panel">
          <div className="revisions-header">
            <h3>Revision History</h3>
            <button
              onClick={closeRevisions}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#333',
                lineHeight: 1,
                padding: '4px 8px'
              }}
            >
              ✕
            </button>
          </div>
          {revisions.length === 0 && (
            <p style={{ padding: '1rem', color: '#666' }}>No revisions yet — start typing to create one!</p>
          )}
          {revisions.map((rev, i) => (
            <div key={i} className="revision-item">
              <div className="revision-info">
                <span className="revision-num">v{revisions.length - i}</span>
                <span className="revision-time">
                  {new Date(rev.savedAt).toLocaleString()}
                </span>
              </div>
              <button onClick={() => restoreRevision(rev.data)}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}