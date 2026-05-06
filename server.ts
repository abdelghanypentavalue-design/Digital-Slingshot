import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import './firebase-admin.js'; // Ensure extension is present for ESM if needed, or omit if using tsx

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

  // Handle favicon.ico requests by serving the SVG version
  app.get('/favicon.ico', (req, res) => {
    res.redirect('/favicon.svg');
  });

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
  const isDev = process.env.NODE_ENV !== 'production';
  
  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    
    app.use('*', async (req, res, next) => {
      // Avoid transforming API routes or static files that Vite should handle
      if (req.originalUrl.includes('.') && !req.originalUrl.endsWith('.html')) {
        return next();
      }

      try {
        const fs = await import('fs');
        const indexPath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        
        // Use req.originalUrl to ensure Vite knows the full path for routing
        template = await vite.transformIndexHtml(req.originalUrl, template);
        
        // Brute-force fallback: If the preamble wasn't injected, add it manually
        if (!template.includes('__vite_plugin_react_preamble_installed__')) {
          const preamble = `<script>window.__vite_plugin_react_preamble_installed__ = true;</script>`;
          template = template.replace('<head>', `<head>${preamble}`);
        }
        
        res.status(200).set({ 'Content-Type': 'text/html' }).send(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
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
