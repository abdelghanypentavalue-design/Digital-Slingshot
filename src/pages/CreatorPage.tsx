import React, { useRef, useState, useEffect } from 'react';
import { motion, useAnimation } from 'motion/react';
import { useNavigate, useParams } from 'react-router-dom';
import { Stage, Layer, Line, Text as KonvaText } from 'react-konva';
import { ChevronLeft, Send, Trash2, Edit3, Type, Image as ImageIcon } from 'lucide-react';
import { socketService } from '../socket';
import { AnimatePresence } from 'motion/react';
import { db, storage, auth } from '../firebase';
import { collection, addDoc, serverTimestamp, doc, getDocFromServer } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

export default function CreatorPage() {
  const { mode } = useParams();
  const navigate = useNavigate();
  
  // Load initial state from localStorage if available with safety catch
  const getSaved = (key: string, fallback: any) => {
    try {
      const val = localStorage.getItem(key);
      if (key.includes('lines') && val) return JSON.parse(val);
      return val || fallback;
    } catch {
      return fallback;
    }
  };

  const [content, setContent] = useState<any>(() => getSaved(`draft_image_${mode}`, null));
  const [text, setText] = useState(() => getSaved(`draft_text_${mode}`, ''));
  const [textColor, setTextColor] = useState('#ffffff');
  const [fontSize, setFontSize] = useState(40);
  const [lines, setLines] = useState<any[]>(() => getSaved(`draft_lines_${mode}`, []));

  const isDrawing = useRef(false);

  // Persistence effects with safety catch
  useEffect(() => {
    try {
       localStorage.setItem(`draft_text_${mode}`, text);
    } catch (e) {}
  }, [text, mode]);

  useEffect(() => {
    try {
       localStorage.setItem(`draft_lines_${mode}`, JSON.stringify(lines));
    } catch (e) {}
  }, [lines, mode]);

  useEffect(() => {
    try {
      if (content) localStorage.setItem(`draft_image_${mode}`, content);
      else localStorage.removeItem(`draft_image_${mode}`);
    } catch (e) {}
  }, [content, mode]);

  const resetDraft = () => {
    if (confirm("Reset current draft?")) {
      setText('');
      setLines([]);
      setContent(null);
      localStorage.removeItem(`draft_text_${mode}`);
      localStorage.removeItem(`draft_lines_${mode}`);
      localStorage.removeItem(`draft_image_${mode}`);
    }
  };

  // Slingshot State
  const workspaceRef = useRef<HTMLDivElement>(null);
  const slingshotRef = useRef<HTMLDivElement>(null);
  const [isSlingshotDragging, setIsSlingshotDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const slingshotAnim = useAnimation();

  const [isLaunching, setIsLaunching] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'pushed' | 'error'>('idle');
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [dbStatus, setDbStatus] = useState<'connecting' | 'online' | 'error'>('connecting');
  const [stageSize, setStageSize] = useState({ width: 300, height: 300 });

  useEffect(() => {
    socketService.connect();
    
    const testDb = async () => {
      try {
        await getDocFromServer(doc(db, '_internal', 'creator_test'));
        setDbStatus('online');
      } catch (error: any) {
        if (error.code === 'permission-denied') setDbStatus('online');
        else setDbStatus('error');
      }
    };
    testDb();
    
    const checkSocket = setInterval(() => {
      setIsSocketConnected(socketService.isConnected());
    }, 1000);

    const updateSize = () => {
      if (workspaceRef.current) {
        // Adjust height calculation to leave room for buttons and UI
        setStageSize({
          width: workspaceRef.current.offsetWidth,
          height: Math.min(workspaceRef.current.offsetHeight - (mode === 'draw' ? 120 : 0), 400)
        });
      }
    };

    window.addEventListener('resize', updateSize);
    updateSize();
    return () => window.removeEventListener('resize', updateSize);
  }, [mode]);

  const handleStartSlingshot = (e: any) => {
    // Prevent default to disable scrolling while interactiving with slingshot
    if (e.cancelable) e.preventDefault();
    const point = (e.touches && e.touches[0]) || e;
    setIsSlingshotDragging(true);
    setDragStart({ x: point.clientX, y: point.clientY });
  };

  const handleMoveSlingshot = (e: any) => {
    if (!isSlingshotDragging) return;
    if (e.cancelable) e.preventDefault();
    const point = (e.touches && e.touches[0]) || e;
    setDragOffset({
      x: point.clientX - dragStart.x,
      y: point.clientY - dragStart.y
    });
  };

  const performLaunch = async (customVelocity?: number, customDirection?: { x: number, y: number }) => {
    if (isLaunching) return;
    const velocity = customVelocity ?? 30;
    const direction = customDirection ?? { x: 0, y: -1 }; 

    setIsLaunching(true);
    setSyncStatus('syncing');

    const launchId = `launch-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const rawPayload = mode === 'text' ? { text, color: textColor, fontSize } : mode === 'draw' ? { lines } : { image: content };
    const enrichedPayload = { ...rawPayload, launchId };

    const launchData = {
      type: mode,
      payload: enrichedPayload,
      velocity,
      direction
    };

    let socketSent = false;
    let apiSent = false;
    let firestoreSent = false;

    // Helper to finish launch successfully
    const finalizeLaunch = () => {
      setSyncStatus('pushed');
      localStorage.removeItem(`draft_text_${mode}`);
      localStorage.removeItem(`draft_lines_${mode}`);
      localStorage.removeItem(`draft_image_${mode}`);
      setTimeout(() => navigate('/modes'), 1800);
    };

    try {
      // 1. ATTEMPT SOCKET PUSH (Fastest)
      if (socketService.isConnected()) {
        socketService.launch(launchData);
        socketSent = true;
      }

      // 2. TRIGGER BACKGROUND SYNC (Concurrent)
      const apiPromise = (async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout
          const response = await fetch(`${window.location.origin}/api/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(launchData),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (response.ok) apiSent = true;
        } catch (e) { console.warn("API Fallback failed:", e); }
      })();

      const firestorePromise = (async () => {
        try {
          let finalPayload = { ...enrichedPayload };
          if (mode === 'image' && content && content.startsWith('data:image')) {
            const storageRef = ref(storage, `uploads/${Date.now()}.png`);
            await uploadString(storageRef, content, 'data_url');
            finalPayload.image = await getDownloadURL(storageRef);
          }
          await addDoc(collection(db, 'items'), {
            ...launchData,
            payload: finalPayload,
            userId: auth.currentUser?.uid || 'guest',
            createdAt: serverTimestamp(),
          });
          firestoreSent = true;
        } catch (e) { console.error("Firestore sync failed:", e); }
      })();

      // 3. ANIMATION TRIGGER
      if (!customVelocity) {
        slingshotAnim.start({
          y: -1000,
          opacity: 0,
          scale: 0.1,
          transition: { duration: 0.5, ease: "easeOut" }
        });
      }

      // 4. WAIT FOR AT LEAST ONE SUCCESS (with very short aggressive timeout for UI fluidity)
      // If socket worked, we take a victory lap immediately. 
      // If not, we wait max 2 seconds for API/Firestore before deciding.
      if (socketSent) {
        finalizeLaunch();
      } else {
        // Wait for API or Firestore to complete or timeout
        await Promise.race([
          apiPromise,
          new Promise(resolve => setTimeout(resolve, 3000)) // Max 3s wait for API
        ]);

        if (apiSent || firestoreSent) {
          finalizeLaunch();
        } else {
          // If we are here, it means we didn't get confirmation yet, but let's check one last time
          // if we can at least show a "Maybe worked" or try to wait a bit longer
          await firestorePromise; // Final stand
          if (firestoreSent) finalizeLaunch();
          else throw new Error("Connection unstable. Sync took too long.");
        }
      }

    } catch (error: any) {
      console.error('Launch failed:', error);
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleEndSlingshot = async () => {
    if (!isSlingshotDragging) return;
    
    // Calculate velocity and direction
    const distance = Math.sqrt(dragOffset.x ** 2 + dragOffset.y ** 2);
    const velocity = Math.min(distance / 10, 50); // Cap velocity
    const direction = {
      x: -dragOffset.x / distance || 0,
      y: -dragOffset.y / distance || 0
    };

    if (distance > 50) {
      // Launch via slingshot animation
      await slingshotAnim.start({
        x: direction.x * 1000,
        y: direction.y * 1000,
        opacity: 0,
        scale: 0.1,
        transition: { duration: 0.5, ease: "easeOut" }
      });
      performLaunch(velocity, direction);
    } else {
      // Snap back
      slingshotAnim.start({ x: 0, y: 0, transition: { type: 'spring', stiffness: 300, damping: 20 } });
      setDragOffset({ x: 0, y: 0 });
    }
    
    setIsSlingshotDragging(false);
  };

  // Canvas Drawing Handlers
  const handleMouseDown = (e: any) => {
    if (mode !== 'draw') return;
    isDrawing.current = true;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    setLines([...lines, { tool: 'pen', points: [pos.x, pos.y], color: textColor }]);
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing.current || mode !== 'draw') return;
    const stage = e.target.getStage();
    if (!stage) return;
    const point = stage.getPointerPosition();
    if (!point) return;
    
    setLines(prevLines => {
      const newLines = [...prevLines];
      if (newLines.length === 0) return prevLines;
      const lastLine = { ...newLines[newLines.length - 1] };
      lastLine.points = lastLine.points.concat([point.x, point.y]);
      newLines[newLines.length - 1] = lastLine;
      return newLines;
    });
  };

  const handleMouseUp = () => {
    isDrawing.current = false;
  };

  return (
    <div className="flex flex-col h-[100dvh] p-4 relative overflow-hidden bg-bg-deep touch-none">
      <div className="glow-sphere top-[0%] left-[0%] opacity-10" />
      
      {/* Header */}
      <div className="flex items-center justify-between mb-6 z-10">
        <button onClick={() => navigate('/modes')} className="p-3 bg-white/5 rounded-full hover:bg-white/10 transition-colors">
          <ChevronLeft />
        </button>
        <div className="flex flex-col items-center">
            <span className="brand-text text-xl tracking-[0.2em] italic">Creative Studio</span>
            <div className="flex gap-2 mt-1">
               <div className={`h-1 w-6 rounded-full transition-colors ${isSocketConnected ? 'bg-green-500/50 shadow-[0_0_5px_#4cd964]' : 'bg-red-500/20'}`} title="Real-time Stream" />
               <div className={`h-1 w-6 rounded-full transition-colors ${dbStatus === 'online' ? 'bg-blue-500/50 shadow-[0_0_5px_#007aff]' : 'bg-red-500/20'}`} title="Cloud Persistence" />
            </div>
        </div>
        <button onClick={resetDraft} className="p-3 bg-red-500/10 text-red-500 rounded-full hover:bg-red-500/20 transition-colors">
          <Trash2 size={20} />
        </button>
      </div>

      {/* Workspace */}
      <div ref={workspaceRef} className="flex-1 glass rounded-[40px] overflow-hidden relative flex flex-col z-10">
        {/* Sync Overlay */}
        <AnimatePresence>
          {syncStatus !== 'idle' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-immersive-purple/95 backdrop-blur-3xl rounded-[40px]"
            >
               {syncStatus === 'syncing' && (
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 border-4 border-accent-glow/20 border-t-accent-glow rounded-full animate-spin mb-6" />
                    <h2 className="brand-text text-2xl text-white">SYNCING...</h2>
                    <p className="text-white/20 mt-2 text-[8px] uppercase tracking-widest">Optimizing for display</p>
                  </div>
               )}

               {syncStatus === 'pushed' && (
                  <div className="flex flex-col items-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1.2 }}
                      className="w-24 h-24 bg-accent-glow rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(191,90,242,0.5)]"
                    >
                      <Send className="text-white" size={40} />
                    </motion.div>
                    <h2 className="brand-text text-4xl text-white">PUSHED!</h2>
                    <p className="text-white/40 mt-4 font-light italic uppercase tracking-[0.3em] text-[10px]">Displayed on Big Screen</p>
                  </div>
               )}

               {syncStatus === 'error' && (
                  <div className="flex flex-col items-center">
                    <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mb-6">
                      <Trash2 className="text-white" size={32} />
                    </div>
                    <h2 className="brand-text text-2xl text-white">SYNC FAILED</h2>
                    <button 
                      onClick={() => setSyncStatus('idle')}
                      className="mt-6 px-6 py-2 bg-white/10 rounded-full text-[10px] uppercase tracking-widest"
                    >
                      Try Again
                    </button>
                  </div>
               )}
            </motion.div>
          )}
        </AnimatePresence>

        {mode === 'text' && (
          <div className="flex-1 flex flex-col p-8 items-center justify-center relative">
             <div className="absolute top-10 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.5em] text-white/20 whitespace-nowrap">Input Surface</div>
            <textarea
              className="w-full bg-transparent text-center text-4xl font-brand italic focus:outline-none placeholder:text-white/10 min-h-[200px]"
              placeholder="What's on your mind?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ color: textColor }}
            />
            
            <div className="flex gap-4 mt-12 flex-wrap justify-center p-4 glass rounded-full">
              {['#ffffff', '#ff2d55', '#bf5af2', '#facc15', '#4ade80'].map(c => (
                <button
                  key={c}
                  onClick={() => setTextColor(c)}
                  className={`w-8 h-8 rounded-full border-2 transition-transform duration-300 ${textColor === c ? 'border-white scale-110 shadow-[0_0_15px_rgba(255,255,255,0.3)]' : 'border-transparent opacity-40'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        )}

        {mode === 'draw' && (
          <div className="flex-1 relative flex flex-col">
            <div className="absolute top-6 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.5em] text-white/20 z-0">Drawing Tablet</div>
            <Stage
              width={stageSize.width}
              height={stageSize.height}
              onMouseDown={handleMouseDown}
              onMousemove={handleMouseMove}
              onMouseup={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseUp}
              className="z-10"
            >
              <Layer>
                {lines.map((line, i) => (
                  <Line
                    key={i}
                    points={line.points}
                    stroke={line.color}
                    strokeWidth={5}
                    tension={0.5}
                    lineCap="round"
                    lineJoin="round"
                  />
                ))}
              </Layer>
            </Stage>
            <div className="px-8 pb-8 flex justify-between items-center z-10">
               <div className="flex gap-3">
                  {['#ffffff', '#ff2d55', '#bf5af2'].map(c => (
                    <button
                      key={c}
                      onClick={() => setTextColor(c)}
                      className={`w-6 h-6 rounded-full border border-white/20 transition-all ${textColor === c ? 'scale-125 border-white shadow-glow' : 'opacity-40'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
               </div>
               <button 
                onClick={() => setLines([])}
                className="p-3 bg-red-500/10 text-red-500 rounded-full hover:bg-red-500/20 transition-colors"
                title="Clear Drawing"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        )}

        {mode === 'image' && (
          <div className="flex-1 flex flex-col p-8 items-center justify-center">
            {content ? (
              <div className="relative group p-4 glass rounded-[30px]">
                <img src={content} className="max-h-[250px] rounded-2xl shadow-2xl" alt="Preview" />
                <button 
                  onClick={() => setContent(null)}
                  className="absolute -top-3 -right-3 p-2 bg-accent-secondary rounded-full shadow-lg"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <label className="w-full max-w-sm aspect-video border-2 border-dashed border-white/10 rounded-[30px] flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-all group">
                <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                  <ImageIcon size={32} className="text-white/40" />
                </div>
                <span className="text-white/20 font-light italic uppercase tracking-[0.3em] text-[10px]">Select Memory</span>
                <input 
                  type="file" 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (re) => {
                        const img = new Image();
                        img.src = re.target?.result as string;
                        img.onload = () => {
                          const canvas = document.createElement('canvas');
                          const MAX_WIDTH = 800;
                          const scale = Math.min(1, MAX_WIDTH / img.width);
                          canvas.width = img.width * scale;
                          canvas.height = img.height * scale;
                          const ctx = canvas.getContext('2d');
                          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                          setContent(canvas.toDataURL('image/jpeg', 0.7));
                        };
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
            )}
          </div>
        )}

        {/* Workspace Controls (Manual Push) */}
        <div className="flex flex-col items-center mb-8 px-8">
           <div className="w-full h-[1px] bg-white/5 mb-8" />
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={(e) => {
              e.preventDefault();
              performLaunch();
            }}
            disabled={isLaunching || (mode === 'text' ? !text.trim() : mode === 'draw' ? lines.length === 0 : !content)}
            className="luxury-button w-full !py-5 text-sm tracking-[0.4em] font-bold shadow-2xl shadow-accent-glow/20 disabled:opacity-20 disabled:grayscale transition-all"
          >
            {isLaunching ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                PUSHING...
              </span>
            ) : "PUSH TO DISPLAY"}
          </motion.button>
        </div>

        {/* Slingshot Trigger Area */}
        <div className="h-44 bg-black/20 flex flex-col items-center justify-center p-4 border-t border-white/5">
          <div 
            ref={slingshotRef}
            className="slingshot-container relative w-full h-full flex flex-col items-center justify-center"
            onMouseDown={handleStartSlingshot}
            onMouseMove={handleMoveSlingshot}
            onMouseUp={handleEndSlingshot}
            onTouchStart={handleStartSlingshot}
            onTouchMove={handleMoveSlingshot}
            onTouchEnd={handleEndSlingshot}
          >
            <AnimatePresence>
              {!isSlingshotDragging ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center"
                >
                  <div className="text-[10px] uppercase tracking-[0.6em] text-white/30 mb-2 font-bold">Manual Launch</div>
                  <div className="text-[9px] text-white/10 uppercase tracking-widest font-light italic">Pull back to slingshot</div>
                </motion.div>
              ) : (
                <div className="absolute flex items-center justify-center">
                   {/* Visual Cord */}
                   <svg className="absolute pointer-events-none" style={{ width: '100vw', height: '100vh', left: -dragOffset.x, top: -dragOffset.y }}>
                    <line 
                      x1="50%" y1="50%" 
                      x2={`calc(50% + ${dragOffset.x}px)`} 
                      y2={`calc(50% + ${dragOffset.y}px)`} 
                      stroke="#bf5af2" 
                      strokeWidth="3"
                      strokeOpacity="0.6"
                    />
                   </svg>
                </div>
              )}
            </AnimatePresence>

            <motion.div
              animate={slingshotAnim}
              style={{ x: dragOffset.x, y: dragOffset.y }}
              className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-2xl relative z-10"
            >
               <div className="absolute inset-0 bg-accent-glow blur-xl opacity-40 rounded-full" />
               <div className="relative z-10 text-bg-deep">
                  {mode === 'text' ? <Type size={24} /> : mode === 'draw' ? <Edit3 size={24} /> : <ImageIcon size={24} />}
               </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );

}
