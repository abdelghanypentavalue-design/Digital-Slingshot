import { io, Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;

  connect() {
    if (!this.socket) {
      this.socket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      });
      this.socket.on('connect', () => {
        console.log('Connected to socket server');
      });
      this.socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err);
      });
    }
    return this.socket;
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  getSocket() {
    return this.socket;
  }

  launch(data: any) {
    if (this.socket) {
      this.socket.emit('launch', data);
    }
  }

  joinDisplay() {
    if (this.socket) {
      this.socket.emit('join-display');
    }
  }

  onNewLaunch(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.on('new-launch', callback);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();
