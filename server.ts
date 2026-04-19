import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  app.use(express.json({ limit: '10mb' }));

  // API Backend endpoints for cross-device support
  app.post('/api/launch', (req, res) => {
    const data = req.body;
    console.log('REST Launch received:', data);
    
    // Broadcast to the display via sockets
    io.to('display').emit('new-launch', {
      ...data,
      source: 'api-rest',
      timestamp: Date.now()
    });

    res.status(200).json({ status: 'success', message: 'Content pushed to display' });
  });

  const PORT = 3000;

  // Real-time communication for Shutter Studio
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join display room for display clients
    socket.on('join-display', () => {
      socket.join('display');
      console.log(`Socket ${socket.id} joined display room`);
    });

    // Launch event
    socket.on('launch', (data) => {
      console.log('Launch data received:', data);
      // Broadcast to all display clients
      io.to('display').emit('new-launch', {
        ...data,
        socketId: socket.id,
        timestamp: Date.now()
      });
    });

    // Admin commands
    socket.on('admin-action', (data) => {
      // In a real app, verify admin status here
      io.to('display').emit('admin-action', data);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
