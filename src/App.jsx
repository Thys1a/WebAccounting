import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  query, where, onSnapshot, serverTimestamp, orderBy, writeBatch, getDoc 
} from 'firebase/firestore';
import { 
  getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken,
  GoogleAuthProvider, signInWithPopup, signOut
} from 'firebase/auth';
import { 
  Plus, Trash2, Edit2, ArrowRight, ArrowLeft, 
  Download, Upload, Wallet, Link as LinkIcon, 
  CheckCircle, AlertCircle, RefreshCw, X,
  LogOut, LogIn
} from 'lucide-react';

// --- Firebase Configuration ---
// const firebaseConfig = JSON.parse(__firebase_config);

const firebaseConfig = {
  apiKey: "AIzaSyAJzUcpyO9oacktLDsjj94wcbz6lHOm-Yo",
  authDomain: "web-accounting-482a0.firebaseapp.com",
  projectId: "web-accounting-482a0",
  storageBucket: "web-accounting-482a0.firebasestorage.app",
  messagingSenderId: "1024117334016",
  appId: "1:1024117334016:web:649f65fe4c6209a94f78e5"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const appId = 'web_accounting';

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('dashboard'); // 'dashboard', 'board-detail'
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeBoard, setActiveBoard] = useState(null);
  
  // Data State
  const [categories, setCategories] = useState([]);
  const [boards, setBoards] = useState([]);
  const [transactions, setTransactions] = useState([]);
  
  // Modals
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [showAddBoardModal, setShowAddBoardModal] = useState(false);
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);

  // --- Authentication & Initialization ---
  useEffect(() => {
    // 监听用户登录状态
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // --- Login & Logout Handlers ---
  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
      // Fallback for demo environment if Popup fails or is blocked
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        // As a last resort for preview if Google auth isn't configured in the environment
        await signInAnonymously(auth);
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setCategories([]);
    setBoards([]);
    setTransactions([]);
    setView('dashboard');
    setActiveCategory(null);
    setActiveBoard(null);
  };

  // --- Data Subscription ---
  useEffect(() => {
    if (!user) return;

    // 1. Categories
    const catQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'categories'), orderBy('createdAt', 'asc'));
    const unsubCat = onSnapshot(catQuery, (snapshot) => {
      const cats = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setCategories(cats);
      
      // Ensure Default Category Exists
      if (cats.length === 0) {
        addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'categories'), {
          name: '默认分类',
          isDefault: true,
          createdAt: serverTimestamp()
        });
      } else if (!activeCategory) {
        // Auto select first category on load if none selected
        setActiveCategory(cats[0]);
      }
    }, (err) => console.error("Cat Error:", err));

    // 2. Boards
    const boardQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'boards'));
    const unsubBoard = onSnapshot(boardQuery, (snapshot) => {
      setBoards(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Board Error:", err));

    // 3. Transactions (Global listener for simplicity in this demo, usually would filter)
    const txQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'), orderBy('date', 'desc'));
    const unsubTx = onSnapshot(txQuery, (snapshot) => {
      setTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Tx Error:", err));

    return () => {
      unsubCat();
      unsubBoard();
      unsubTx();
    };
  }, [user]);

  // --- Logic: Category Management ---
  const handleAddCategory = async (name) => {
    if (!name.trim()) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'categories'), {
        name,
        isDefault: false,
        createdAt: serverTimestamp()
      });
      setShowAddCatModal(false);
    } catch (e) { console.error(e); }
  };

  const handleDeleteCategory = async (catId) => {
    const catToDelete = categories.find(c => c.id === catId);
    if (catToDelete.isDefault) {
      alert("无法删除默认分类");
      return;
    }

    const defaultCat = categories.find(c => c.isDefault);
    if (!defaultCat) return;

    // Batch update: Move boards to default, then delete category
    const batch = writeBatch(db);
    
    // Find boards in this category
    const boardsToMove = boards.filter(b => b.categoryId === catId);
    boardsToMove.forEach(b => {
      const ref = doc(db, 'artifacts', appId, 'users', user.uid, 'boards', b.id);
      batch.update(ref, { categoryId: defaultCat.id });
    });

    const catRef = doc(db, 'artifacts', appId, 'users', user.uid, 'categories', catId);
    batch.delete(catRef);

    await batch.commit();
    if (activeCategory.id === catId) setActiveCategory(defaultCat);
  };

  // --- Logic: Board Management & Parent/Child ---
  const handleAddBoard = async (data) => {
    // data: { name, categoryId, parentId (opt), allocationAmount (opt) }
    const batch = writeBatch(db);
    const newBoardRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'boards'));
    
    const boardData = {
      name: data.name,
      categoryId: activeCategory.id,
      parentId: data.parentId || null,
      status: 'active', // active, closed
      createdAt: serverTimestamp()
    };
    batch.set(newBoardRef, boardData);

    // If linking to parent, handle money flow
    if (data.parentId && data.allocationAmount) {
      const amount = parseFloat(data.allocationAmount);
      
      // 1. Expense in Parent (Allocation)
      const parentTxRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(parentTxRef, {
        boardId: data.parentId,
        amount: -amount,
        type: 'allocation_out',
        linkedBoardId: newBoardRef.id,
        description: `资金分配 -> ${data.name}`,
        date: new Date().toISOString()
      });

      // 2. Income in Child (Initial Budget)
      const childTxRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(childTxRef, {
        boardId: newBoardRef.id,
        amount: amount,
        type: 'allocation_in',
        linkedBoardId: data.parentId,
        description: `初始资金 <- 父账本`,
        date: new Date().toISOString()
      });
    }

    await batch.commit();
    setShowAddBoardModal(false);
  };

  const handleSettleBoard = async () => {
    if (!activeBoard || !activeBoard.parentId) return;
    
    // Calculate current balance
    const boardTxs = transactions.filter(t => t.boardId === activeBoard.id);
    const balance = boardTxs.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    if (balance > 0) {
      // Surplus: Return to Parent
      // 1. Child Expense (Return)
      const childRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(childRef, {
        boardId: activeBoard.id,
        amount: -balance,
        type: 'return_out',
        description: '结余归还 -> 父账本',
        date: now
      });
      // 2. Parent Income (Refund)
      const parentRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(parentRef, {
        boardId: activeBoard.parentId,
        amount: balance,
        type: 'return_in',
        description: `资金退回 <- ${activeBoard.name}`,
        date: now
      });
    } else if (balance < 0) {
      // Deficit: Cover by Parent
      const absBal = Math.abs(balance);
      // 1. Child Income (Cover)
      const childRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(childRef, {
        boardId: activeBoard.id,
        amount: absBal,
        type: 'cover_in',
        description: '超支补足 <- 父账本',
        date: now
      });
      // 2. Parent Expense (Cover)
      const parentRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(parentRef, {
        boardId: activeBoard.parentId,
        amount: -absBal,
        type: 'cover_out',
        description: `填补亏空 -> ${activeBoard.name}`,
        date: now
      });
    }

    // Mark board as closed
    const boardRef = doc(db, 'artifacts', appId, 'users', user.uid, 'boards', activeBoard.id);
    batch.update(boardRef, { status: 'closed' });

    await batch.commit();
    setShowSettleModal(false);
  };

  // --- Logic: Transactions ---
  const handleAddTransaction = async (data) => {
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'), {
      boardId: activeBoard.id,
      amount: data.type === 'expense' ? -Math.abs(data.amount) : Math.abs(data.amount),
      description: data.description,
      type: 'normal',
      date: new Date().toISOString() // Simplification for demo
    });
    setShowAddTxModal(false);
  };

  // --- Logic: Import/Export ---
  const handleExportCSV = () => {
    if (!activeBoard) return;
    const boardTxs = transactions.filter(t => t.boardId === activeBoard.id);
    
    // Header Data (Row 1 Metadata)
    const metaRow = `BoardName,${activeBoard.name},ParentID,${activeBoard.parentId || 'None'},Status,${activeBoard.status}`;
    // Columns (Row 2)
    const headers = `Date,Description,Amount,Type`;
    // Data (Row 3+)
    const rows = boardTxs.map(t => `${t.date},"${t.description}",${t.amount},${t.type}`).join('\n');
    
    const csvContent = `${metaRow}\n${headers}\n${rows}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${activeBoard.name}_export.csv`);
    document.body.appendChild(link);
    link.click();
  };

  const handleImportCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const lines = text.split('\n');
      if (lines.length < 2) return alert("文件格式错误");

      // Parse Meta
      const metaParts = lines[0].split(',');
      const boardName = metaParts[1] || 'Imported Board';
      
      // Create Board
      const newBoardRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'boards'), {
        name: boardName + ' (Imported)',
        categoryId: activeCategory.id,
        parentId: null, // Reset parent on import for safety
        status: 'active',
        createdAt: serverTimestamp()
      });

      // Parse Transactions (Skip row 0 and 1)
      const batch = writeBatch(db);
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        // Simple CSV parse handling quotes poorly, but sufficient for this demo format
        const parts = line.split(','); 
        
        // Very basic parsing for demo
        const date = parts[0];
        // If description has quotes, strip them.
        const description = parts[1] ? parts[1].replace(/"/g, '') : ''; 
        const amount = parseFloat(parts[2]);
        const type = parts[3]?.trim() || 'normal';

        if (!isNaN(amount)) {
            const txRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
            batch.set(txRef, {
                boardId: newBoardRef.id,
                amount, description, date, type
            });
        }
      }
      await batch.commit();
      alert("导入成功！");
    };
    reader.readAsText(file);
  };

  // --- Derived State Helpers ---
  const getBoardBalance = (boardId) => {
    return transactions
      .filter(t => t.boardId === boardId)
      .reduce((acc, t) => acc + parseFloat(t.amount), 0);
  };

  const currentBoardList = boards.filter(b => b.categoryId === activeCategory?.id);
  const currentBoardTxs = transactions.filter(t => t.boardId === activeBoard?.id);
  const currentBoardBalance = activeBoard ? getBoardBalance(activeBoard.id) : 0;

  // --- Render: Login Screen ---
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-800">
        <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 shadow-xl">
          <Wallet className="w-8 h-8 text-emerald-400" />
        </div>
        <h1 className="text-3xl font-bold mb-2">FinanceFlow Pro</h1>
        <p className="text-slate-500 mb-8">安全、持久的云端记账</p>
        
        <button 
          onClick={handleGoogleLogin}
          className="flex items-center gap-3 bg-white border border-slate-300 px-6 py-3 rounded-xl font-medium shadow-sm hover:bg-slate-50 hover:shadow-md transition-all"
        >
          <span className="font-bold text-blue-500">G</span>
          使用 Google 账号登录
        </button>
      </div>
    );
  }

  // --- Render: Main App ---
  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      
      {/* SIDEBAR */}
      <div className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-20">
        <div className="p-6">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-400" />
            FinanceFlow
          </h1>
          {/* 显示当前用户 */}
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 bg-slate-800/50 p-2 rounded-lg">
             {user.photoURL ? (
               <img src={user.photoURL} className="w-6 h-6 rounded-full" alt="avatar"/>
             ) : (
               <div className="w-6 h-6 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold">
                 {user.email?.[0]?.toUpperCase()}
               </div>
             )}
             <span className="truncate flex-1">{user.displayName || user.email}</span>
             <button onClick={handleLogout} title="退出登录" className="hover:text-white">
               <LogOut className="w-3 h-3" />
             </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 mt-4">
            <span>Categories</span>
            <button onClick={() => setShowAddCatModal(true)} className="hover:text-white transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          {categories.map(cat => (
            <div 
              key={cat.id}
              onClick={() => { setActiveCategory(cat); setView('dashboard'); }}
              className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all duration-200 ${activeCategory?.id === cat.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' : 'hover:bg-slate-800'}`}
            >
              <span className="truncate font-medium">{cat.name}</span>
              {!cat.isDefault && (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id); }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity p-1"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        
        <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center">
          Persisted securely via Firebase
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Top Navigation Bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center px-8 justify-between shadow-sm z-10">
          <div className="flex items-center gap-4">
            {view === 'board-detail' && (
              <button onClick={() => setView('dashboard')} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-xl font-bold text-slate-800">
              {view === 'dashboard' ? activeCategory?.name : activeBoard?.name}
            </h2>
            {view === 'board-detail' && activeBoard?.parentId && (
              <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full border border-blue-100">
                <LinkIcon className="w-3 h-3" /> 子账本
              </span>
            )}
             {view === 'board-detail' && activeBoard?.status === 'closed' && (
              <span className="flex items-center gap-1 text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded-full border border-slate-200">
                <CheckCircle className="w-3 h-3" /> 已归档
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3">
             {view === 'board-detail' && (
               <>
                 <label className="cursor-pointer p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" title="Import CSV">
                    <input type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
                    <Upload className="w-5 h-5" />
                 </label>
                 <button onClick={handleExportCSV} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" title="Export CSV">
                    <Download className="w-5 h-5" />
                 </button>
                 {activeBoard?.parentId && activeBoard.status === 'active' && (
                    <button 
                      onClick={() => setShowSettleModal(true)}
                      className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      结算归还
                    </button>
                 )}
               </>
             )}
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 overflow-y-auto p-8 bg-slate-50">
          
          {/* VIEW: DASHBOARD (List Boards) */}
          {view === 'dashboard' && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {/* Add New Board Card */}
                <button 
                  onClick={() => setShowAddBoardModal(true)}
                  className="group flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 transition-all cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center mb-3 transition-colors">
                    <Plus className="w-6 h-6 text-slate-400 group-hover:text-indigo-500" />
                  </div>
                  <span className="text-slate-500 font-medium group-hover:text-indigo-600">新建账本</span>
                </button>

                {/* Existing Boards */}
                {currentBoardList.map(board => {
                   const bal = getBoardBalance(board.id);
                   return (
                    <div 
                      key={board.id}
                      onClick={() => { setActiveBoard(board); setView('board-detail'); }}
                      className={`relative bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between h-48 overflow-hidden group ${board.status === 'closed' ? 'opacity-60 grayscale' : ''}`}
                    >
                      {/* Decorative stripe */}
                      <div className={`absolute top-0 left-0 w-1 h-full ${bal >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}`}></div>
                      
                      <div>
                        <div className="flex justify-between items-start">
                          <h3 className="font-semibold text-lg text-slate-800 line-clamp-1 pr-2">{board.name}</h3>
                          {board.parentId && <LinkIcon className="w-4 h-4 text-blue-400 shrink-0" />}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">Updated {new Date(board.createdAt?.seconds * 1000).toLocaleDateString()}</p>
                      </div>

                      <div>
                        <span className="text-xs font-medium text-slate-400 uppercase">Current Balance</span>
                        <div className={`text-3xl font-bold tracking-tight mt-1 ${bal >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>
                          ¥{bal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      
                      {/* Hover Action */}
                      <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity">
                         <div className="bg-slate-100 p-2 rounded-full text-slate-600">
                           <ArrowRight className="w-4 h-4" />
                         </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* VIEW: BOARD DETAIL */}
          {view === 'board-detail' && activeBoard && (
            <div className="max-w-4xl mx-auto">
              
              {/* Summary Header */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 mb-8 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium text-slate-500 uppercase tracking-wide">当前结余</h4>
                  <div className={`text-5xl font-bold mt-2 ${currentBoardBalance >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>
                    ¥{currentBoardBalance.toLocaleString()}
                  </div>
                  {activeBoard.status === 'closed' && <span className="text-red-500 text-sm font-bold mt-2 block">已停止记账</span>}
                </div>
                
                {activeBoard.status === 'active' && (
                  <button 
                    onClick={() => setShowAddTxModal(true)}
                    className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-medium flex items-center gap-2 shadow-lg shadow-slate-900/20 transition-all hover:scale-105 active:scale-95"
                  >
                    <Plus className="w-5 h-5" /> 记一笔
                  </button>
                )}
              </div>

              {/* Child Board Links (If this is a parent) */}
              {/* Logic: Search if any board has parentId == activeBoard.id */}
              {(() => {
                 const children = boards.filter(b => b.parentId === activeBoard.id);
                 if (children.length === 0) return null;
                 return (
                   <div className="mb-8">
                     <h3 className="text-sm font-bold text-slate-400 uppercase mb-4 pl-2">关联的子账本 (分配管理)</h3>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {children.map(child => {
                         const childBal = getBoardBalance(child.id);
                         const childAllocatedTx = transactions.find(t => t.linkedBoardId === child.id && t.type === 'allocation_out');
                         const initialAlloc = childAllocatedTx ? Math.abs(childAllocatedTx.amount) : 0;
                         const used = initialAlloc - childBal; // Approx logic
                         
                         return (
                           <div key={child.id} className="bg-white border border-slate-100 p-4 rounded-xl flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => { setActiveBoard(child); }}>
                             <div>
                               <div className="font-semibold text-slate-700 flex items-center gap-2">
                                 {child.name}
                                 {child.status === 'closed' && <span className="text-[10px] bg-gray-100 text-gray-500 px-1 rounded">CLOSED</span>}
                               </div>
                               <div className="text-xs text-slate-400 mt-1">
                                 分配: ¥{initialAlloc} | 剩余: ¥{childBal}
                               </div>
                             </div>
                             <div className="text-right">
                               <div className="text-xs text-slate-400">已使用</div>
                               <div className="font-bold text-rose-500">¥{used.toLocaleString()}</div>
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   </div>
                 );
              })()}

              {/* Transactions List */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="font-bold text-slate-700">收支明细</h3>
                  <span className="text-xs text-slate-400">{currentBoardTxs.length} 笔交易</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {currentBoardTxs.length === 0 ? (
                    <div className="p-12 text-center text-slate-400">暂无数据</div>
                  ) : (
                    currentBoardTxs.map(tx => (
                      <div key={tx.id} className="px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 
                            ${['allocation_in', 'return_in', 'cover_in'].includes(tx.type) ? 'bg-blue-100 text-blue-600' :
                              ['allocation_out', 'return_out', 'cover_out'].includes(tx.type) ? 'bg-purple-100 text-purple-600' :
                              parseFloat(tx.amount) > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                             {['allocation_in', 'allocation_out'].includes(tx.type) ? <LinkIcon className="w-5 h-5" /> : 
                              ['return_in', 'return_out', 'cover_in', 'cover_out'].includes(tx.type) ? <RefreshCw className="w-5 h-5" /> :
                              <Wallet className="w-5 h-5" />}
                          </div>
                          <div>
                            <div className="font-medium text-slate-800">{tx.description}</div>
                            <div className="text-xs text-slate-400">{new Date(tx.date).toLocaleString()}</div>
                          </div>
                        </div>
                        <div className={`font-bold font-mono text-lg 
                           ${parseFloat(tx.amount) > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                          {parseFloat(tx.amount) > 0 ? '+' : ''}{parseFloat(tx.amount).toLocaleString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* --- MODALS --- */}
      
      {/* 1. ADD CATEGORY */}
      {showAddCatModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">添加新分类</h3>
            <form onSubmit={(e) => { e.preventDefault(); handleAddCategory(e.target.catName.value); }}>
              <input name="catName" autoFocus placeholder="分类名称 (e.g., 旅行, 装修)" className="w-full border border-slate-300 rounded-lg p-3 mb-4 focus:ring-2 focus:ring-indigo-500 outline-none" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddCatModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">添加</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. ADD BOARD */}
      {showAddBoardModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">新建账本</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              handleAddBoard({
                name: formData.get('name'),
                parentId: formData.get('parentId') || null,
                allocationAmount: formData.get('allocation')
              });
            }}>
              <label className="block text-sm font-medium text-slate-600 mb-1">账本名称</label>
              <input name="name" required placeholder="例如: 2024日本游" className="w-full border border-slate-300 rounded-lg p-3 mb-4 focus:ring-2 focus:ring-indigo-500 outline-none" />
              
              <label className="block text-sm font-medium text-slate-600 mb-1">关联父账本 (可选)</label>
              <select name="parentId" className="w-full border border-slate-300 rounded-lg p-3 mb-2 bg-white outline-none">
                <option value="">无 (独立账本)</option>
                {boards.filter(b => b.status === 'active').map(b => (
                  <option key={b.id} value={b.id}>{b.name} (余额: {getBoardBalance(b.id)})</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mb-4">选择父账本可实现资金分配与归还逻辑。</p>

              {/* Conditional Input via JS logic or just Show Always but validate */}
              <label className="block text-sm font-medium text-slate-600 mb-1">初始资金分配</label>
              <input name="allocation" type="number" step="0.01" placeholder="0.00" className="w-full border border-slate-300 rounded-lg p-3 mb-6 focus:ring-2 focus:ring-indigo-500 outline-none" />

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddBoardModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. ADD TRANSACTION */}
      {showAddTxModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">记一笔</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.target);
              handleAddTransaction({
                amount: fd.get('amount'),
                description: fd.get('desc'),
                type: fd.get('type')
              });
            }}>
              <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-lg">
                <label className="flex-1 text-center cursor-pointer">
                  <input type="radio" name="type" value="expense" defaultChecked className="peer hidden" />
                  <div className="py-2 rounded-md text-slate-500 peer-checked:bg-white peer-checked:text-rose-600 peer-checked:shadow-sm font-medium transition-all">支出</div>
                </label>
                <label className="flex-1 text-center cursor-pointer">
                  <input type="radio" name="type" value="income" className="peer hidden" />
                  <div className="py-2 rounded-md text-slate-500 peer-checked:bg-white peer-checked:text-emerald-600 peer-checked:shadow-sm font-medium transition-all">收入</div>
                </label>
              </div>

              <input name="amount" type="number" step="0.01" required placeholder="0.00" autoFocus className="w-full text-3xl font-bold text-center border-b-2 border-slate-200 p-4 mb-4 focus:border-indigo-500 outline-none bg-transparent" />
              
              <input name="desc" required placeholder="备注 (e.g., 晚餐)" className="w-full border border-slate-300 rounded-lg p-3 mb-6 focus:ring-2 focus:ring-indigo-500 outline-none" />

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddTxModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. SETTLE BOARD CONFIRMATION */}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <div className="text-center mb-4">
              <div className="bg-indigo-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                <RefreshCw className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold">结束并结算账本?</h3>
            </div>
            
            <p className="text-slate-500 text-sm mb-6 text-center">
              此操作将标记 "{activeBoard?.name}" 为结束状态。<br/><br/>
              当前余额 <span className="font-bold text-slate-800">{currentBoardBalance}</span> 将会自动
              {currentBoardBalance > 0 ? " 退还给父账本。" : " 由父账本填补。"}
            </p>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowSettleModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
              <button onClick={handleSettleBoard} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">确认结算</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}