import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { Trash2, LogOut, ShieldCheck } from 'lucide-react';
import { socketService } from '../socket';

import { collection, query, getDocs, deleteDoc, doc, orderBy } from 'firebase/firestore';

export default function AdminPage() {
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ items: 0 });
  const [itemsList, setItemsList] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const fetchItems = async () => {
    if (!user) return;
    setLoadingItems(true);
    try {
      const q = query(collection(db, 'items'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setItemsList(items);
      setStats({ items: items.length });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingItems(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [user]);

  const deleteSingleItem = async (id: string) => {
    if (confirm("Delete this item?")) {
      try {
        await deleteDoc(doc(db, 'items', id));
        fetchItems();
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const clearDisplay = async () => {
    if (!confirm("Clear all items from the display and database?")) return;
    try {
      // 1. Clear from Display via Sockets (instant)
      socketService.connect();
      socketService.getSocket()?.emit('admin-action', { action: 'clear' });

      // 2. Delete from Firestore
      const q = query(collection(db, 'items'));
      const snap = await getDocs(q);
      const batchPromises = snap.docs.map(d => deleteDoc(doc(db, 'items', d.id)));
      await Promise.all(batchPromises);
      setStats({ items: 0 });
      alert('Display cleared and database reset.');
    } catch (err: any) {
      alert('Failed to clear: ' + err.message);
    }
  };

  if (loading) return <div className="flex h-[100dvh] items-center justify-center">Loading...</div>;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh] p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass p-12 rounded-[40px] w-full max-w-md"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="bg-luxury-glow/20 p-4 rounded-full mb-4">
              <ShieldCheck className="text-luxury-glow" size={32} />
            </div>
            <h1 className="text-2xl font-serif font-bold">Admin Portal</h1>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Email</label>
              <input 
                type="email" 
                className="luxury-input w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="abdelghany@admin.com"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-white/40 mb-2">Password</label>
              <input 
                type="password" 
                className="luxury-input w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
              />
            </div>
            <button type="submit" className="luxury-button w-full mt-4">AUTHENTICATE</button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-12">
        <h1 className="text-3xl font-serif font-bold italic">Command Center</h1>
        <button onClick={() => signOut(auth)} className="flex items-center gap-2 text-white/40 hover:text-white transition-colors uppercase tracking-[0.2em] text-[10px]">
          <LogOut size={16} /> Logout
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        <div className="glass p-8 rounded-[30px] lg:col-span-1">
          <h2 className="text-xl mb-4 font-medium italic">Display Controls</h2>
          <p className="text-white/20 text-xs mb-8 uppercase tracking-widest leading-relaxed">Manage the global live stage</p>
          
          <button 
            onClick={clearDisplay}
            className="flex items-center justify-center gap-3 w-full p-6 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500/20 transition-all border border-red-500/20 shadow-lg shadow-red-500/5 group"
          >
            <Trash2 size={24} className="group-hover:scale-110 transition-transform" /> 
            <span className="font-bold tracking-[0.2em] text-xs">CLEAR ALL</span>
          </button>
        </div>

        <div className="glass p-8 rounded-[30px] lg:col-span-2">
          <h2 className="text-xl mb-4 font-medium italic">Session Overview</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-6 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-white/20 text-[10px] uppercase tracking-widest block mb-2">Live Items</span>
              <span className="text-4xl font-serif">{stats.items}</span>
            </div>
            <div className="p-6 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-white/20 text-[10px] uppercase tracking-widest block mb-2">Connection</span>
              <span className="text-sm font-mono text-green-400 flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Active Session
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="glass rounded-[30px] overflow-hidden">
        <div className="p-8 border-b border-white/5 flex justify-between items-center">
            <h2 className="text-xl font-medium italic">Recent Launches</h2>
            <button onClick={fetchItems} className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors">Refresh List</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-white/5 text-white/20 text-[10px] uppercase tracking-widest">
                <th className="px-8 py-4">Type</th>
                <th className="px-8 py-4">Content</th>
                <th className="px-8 py-4">Time</th>
                <th className="px-8 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {itemsList.map((item) => (
                <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-8 py-6 capitalize font-light italic">{item.type}</td>
                  <td className="px-8 py-6 max-w-xs truncate text-white/60">
                    {item.type === 'text' ? item.payload.text : item.type === 'draw' ? `${item.payload.lines.length} lines` : 'Image Upload'}
                  </td>
                  <td className="px-8 py-6 text-white/20 text-xs">
                    {item.createdAt?.toDate().toLocaleTimeString() || 'Just now'}
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button 
                      onClick={() => deleteSingleItem(item.id)}
                      className="p-3 bg-red-500/10 text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/20"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {itemsList.length === 0 && !loadingItems && (
                <tr>
                  <td colSpan={4} className="px-8 py-12 text-center text-white/20 italic">No items found in current session</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
