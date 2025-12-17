import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, doc, 
  query, onSnapshot, serverTimestamp, orderBy, writeBatch 
} from 'firebase/firestore';
import { 
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile
} from 'firebase/auth';
import { 
  Plus, Trash2, ArrowRight, ArrowLeft, 
  Download, Upload, Wallet, Link as LinkIcon, 
  CheckCircle, RefreshCw, LogOut, Loader2
} from 'lucide-react';

// --- Firebase Configuration ---
// [⚠️ 重要说明] 
// 下面的配置是为了让右侧预览窗口能正常工作。
// 当您部署到 GitHub Pages 或本地运行时，请删除下面的 try-catch 块，
// 并取消注释更下方的 "Production Configuration" 代码块。

// let firebaseConfig;
// let appId;

// try {
//   // 预览环境专用配置
//   firebaseConfig = JSON.parse(__firebase_config);
//   appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
// } catch (e) {
//   // 本地/生产环境回退配置 (防止报错)
//   firebaseConfig = {}; 
//   appId = 'default-app';
// }

// --- Production Configuration (部署时请取消注释此段) ---
// 务必确保 .env 文件中有这些变量，且以 VITE_ 开头
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
const appId = import.meta.env.VITE_FIREBASE_APP_ID || 'default-app';


// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true); // 初始加载状态
  const [view, setView] = useState('dashboard'); 
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeBoard, setActiveBoard] = useState(null);
  
  // Login/Signup Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false); // Toggle between Login and Sign Up
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Data State
  const [categories, setCategories] = useState([]);
  const [boards, setBoards] = useState([]);
  const [transactions, setTransactions] = useState([]);
  
  // Modals
  const [showAddCatModal, setShowAddCatModal] = useState(false);
  const [showAddBoardModal, setShowAddBoardModal] = useState(false);
  const [showAddTxModal, setShowAddTxModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);

  // --- Authentication Listener ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- Auth Handlers ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setIsSubmitting(true);

    try {
      if (isSignUp) {
        // Sign Up
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Optional: Set default display name part of email
        await updateProfile(userCredential.user, {
          displayName: email.split('@')[0]
        });
      } else {
        // Login
        await signInWithEmailAndPassword(auth, email, password);
      }
      // Success is handled by onAuthStateChanged
    } catch (error) {
      console.error(error);
      let msg = "认证失败，请重试。";
      if (error.code === 'auth/invalid-credential') msg = "邮箱或密码错误。";
      if (error.code === 'auth/email-already-in-use') msg = "该邮箱已被注册。";
      if (error.code === 'auth/weak-password') msg = "密码太弱，请至少使用6位字符。";
      if (error.code === 'auth/invalid-email') msg = "邮箱格式不正确。";
      setAuthError(msg);
    } finally {
      setIsSubmitting(false);
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
      
      if (cats.length === 0) {
        addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'categories'), {
          name: '默认分类',
          isDefault: true,
          createdAt: serverTimestamp()
        });
      } else if (!activeCategory) {
        setActiveCategory(cats[0]);
      }
    }, (err) => console.error("Cat Error:", err));

    // 2. Boards
    const boardQuery = query(collection(db, 'artifacts', appId, 'users', user.uid, 'boards'));
    const unsubBoard = onSnapshot(boardQuery, (snapshot) => {
      setBoards(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Board Error:", err));

    // 3. Transactions
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

  // --- Core Logic Functions (Same as before) ---
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

    const batch = writeBatch(db);
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

  const handleAddBoard = async (data) => {
    const batch = writeBatch(db);
    const newBoardRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'boards'));
    
    const boardData = {
      name: data.name,
      categoryId: activeCategory.id,
      parentId: data.parentId || null,
      status: 'active',
      createdAt: serverTimestamp()
    };
    batch.set(newBoardRef, boardData);

    if (data.parentId && data.allocationAmount) {
      const amount = parseFloat(data.allocationAmount);
      const parentTxRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(parentTxRef, {
        boardId: data.parentId,
        amount: -amount,
        type: 'allocation_out',
        linkedBoardId: newBoardRef.id,
        description: `资金分配 -> ${data.name}`,
        date: new Date().toISOString()
      });
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
    const boardTxs = transactions.filter(t => t.boardId === activeBoard.id);
    const balance = boardTxs.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    if (balance > 0) {
      const childRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(childRef, {
        boardId: activeBoard.id,
        amount: -balance,
        type: 'return_out',
        description: '结余归还 -> 父账本',
        date: now
      });
      const parentRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(parentRef, {
        boardId: activeBoard.parentId,
        amount: balance,
        type: 'return_in',
        description: `资金退回 <- ${activeBoard.name}`,
        date: now
      });
    } else if (balance < 0) {
      const absBal = Math.abs(balance);
      const childRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(childRef, {
        boardId: activeBoard.id,
        amount: absBal,
        type: 'cover_in',
        description: '超支补足 <- 父账本',
        date: now
      });
      const parentRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'));
      batch.set(parentRef, {
        boardId: activeBoard.parentId,
        amount: -absBal,
        type: 'cover_out',
        description: `填补亏空 -> ${activeBoard.name}`,
        date: now
      });
    }
    const boardRef = doc(db, 'artifacts', appId, 'users', user.uid, 'boards', activeBoard.id);
    batch.update(boardRef, { status: 'closed' });

    await batch.commit();
    setShowSettleModal(false);
  };

  const handleAddTransaction = async (data) => {
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'transactions'), {
      boardId: activeBoard.id,
      amount: data.type === 'expense' ? -Math.abs(data.amount) : Math.abs(data.amount),
      description: data.description,
      type: 'normal',
      date: new Date().toISOString()
    });
    setShowAddTxModal(false);
  };

  const handleExportCSV = () => {
    if (!activeBoard) return;
    const boardTxs = transactions.filter(t => t.boardId === activeBoard.id);
    const metaRow = `BoardName,${activeBoard.name},ParentID,${activeBoard.parentId || 'None'},Status,${activeBoard.status}`;
    const headers = `Date,Description,Amount,Type`;
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

      const metaParts = lines[0].split(',');
      const boardName = metaParts[1] || 'Imported Board';
      
      const newBoardRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'boards'), {
        name: boardName + ' (Imported)',
        categoryId: activeCategory.id,
        parentId: null,
        status: 'active',
        createdAt: serverTimestamp()
      });

      const batch = writeBatch(db);
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const parts = line.split(','); 
        const date = parts[0];
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

  const getBoardBalance = (boardId) => {
    return transactions
      .filter(t => t.boardId === boardId)
      .reduce((acc, t) => acc + parseFloat(t.amount), 0);
  };

  const currentBoardList = boards.filter(b => b.categoryId === activeCategory?.id);
  const currentBoardTxs = transactions.filter(t => t.boardId === activeBoard?.id);
  const currentBoardBalance = activeBoard ? getBoardBalance(activeBoard.id) : 0;

  // --- Render: Auth & Loading ---
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-800 p-4">
        <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 shadow-xl">
          <Wallet className="w-8 h-8 text-emerald-400" />
        </div>
        <h1 className="text-3xl font-bold mb-2">FinanceFlow Pro</h1>
        <p className="text-slate-500 mb-8 text-center max-w-sm">
          {isSignUp ? "创建您的账户以开始同步数据" : "登录以访问您的云端账本"}
        </p>
        
        <form onSubmit={handleAuth} className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-lg border border-slate-100">
          {authError && (
             <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2">
               <span className="font-bold">Error:</span> {authError}
             </div>
          )}
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">电子邮箱</label>
              <input 
                type="email" 
                required
                className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">密码</label>
              <input 
                type="password" 
                required
                minLength={6}
                className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isSubmitting}
            className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : (isSignUp ? "注册账号" : "立即登录")}
          </button>

          <div className="mt-6 text-center text-sm text-slate-500">
            {isSignUp ? "已有账号？" : "还没有账号？"} 
            <button 
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); }}
              className="ml-1 text-indigo-600 font-bold hover:underline"
            >
              {isSignUp ? "去登录" : "免费注册"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // --- Render: Main App (Same as before) ---
  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans overflow-hidden">
      
      {/* SIDEBAR */}
      <div className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-20">
        <div className="p-6">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-400" />
            FinanceFlow
          </h1>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 bg-slate-800/50 p-2 rounded-lg">
             <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold shrink-0">
               {user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
             </div>
             <div className="flex flex-col overflow-hidden">
               <span className="truncate font-medium text-slate-300">{user.displayName || '用户'}</span>
               <span className="truncate text-[10px]">{user.email}</span>
             </div>
             <button onClick={handleLogout} title="退出登录" className="ml-auto hover:text-white p-1">
               <LogOut className="w-4 h-4" />
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
          
          {/* VIEW: DASHBOARD */}
          {view === 'dashboard' && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <button 
                  onClick={() => setShowAddBoardModal(true)}
                  className="group flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 transition-all cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center mb-3 transition-colors">
                    <Plus className="w-6 h-6 text-slate-400 group-hover:text-indigo-500" />
                  </div>
                  <span className="text-slate-500 font-medium group-hover:text-indigo-600">新建账本</span>
                </button>

                {currentBoardList.map(board => {
                   const bal = getBoardBalance(board.id);
                   return (
                    <div 
                      key={board.id}
                      onClick={() => { setActiveBoard(board); setView('board-detail'); }}
                      className={`relative bg-white p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:-translate-y-1 transition-all cursor-pointer flex flex-col justify-between h-48 overflow-hidden group ${board.status === 'closed' ? 'opacity-60 grayscale' : ''}`}
                    >
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

              {/* Transactions List (略微简化显示) */}
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

      {/* MODALS - 省略重复代码，结构与之前一致，只需保持逻辑 */}
      {showAddCatModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">添加新分类</h3>
            <form onSubmit={(e) => { e.preventDefault(); handleAddCategory(e.target.catName.value); }}>
              <input name="catName" autoFocus placeholder="分类名称" className="w-full border border-slate-300 rounded-lg p-3 mb-4 outline-none focus:border-indigo-500" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddCatModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg">添加</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddBoardModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">新建账本</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.target);
              handleAddBoard({ name: fd.get('name'), parentId: fd.get('parentId'), allocationAmount: fd.get('allocation') });
            }}>
              <input name="name" required placeholder="账本名称" className="w-full border border-slate-300 rounded-lg p-3 mb-4 outline-none focus:border-indigo-500" />
              <select name="parentId" className="w-full border border-slate-300 rounded-lg p-3 mb-4 bg-white outline-none">
                <option value="">无 (独立账本)</option>
                {boards.filter(b => b.status === 'active').map(b => (
                  <option key={b.id} value={b.id}>{b.name} (余额: {getBoardBalance(b.id)})</option>
                ))}
              </select>
              <input name="allocation" type="number" step="0.01" placeholder="初始资金 (可选)" className="w-full border border-slate-300 rounded-lg p-3 mb-6 outline-none focus:border-indigo-500" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddBoardModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddTxModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4">记一笔</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.target);
              handleAddTransaction({ amount: fd.get('amount'), description: fd.get('desc'), type: fd.get('type') });
            }}>
              <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-lg">
                <label className="flex-1 text-center cursor-pointer"><input type="radio" name="type" value="expense" defaultChecked className="hidden peer" /><span className="block py-2 rounded peer-checked:bg-white peer-checked:text-rose-600 shadow-sm transition-all">支出</span></label>
                <label className="flex-1 text-center cursor-pointer"><input type="radio" name="type" value="income" className="hidden peer" /><span className="block py-2 rounded peer-checked:bg-white peer-checked:text-emerald-600 shadow-sm transition-all">收入</span></label>
              </div>
              <input name="amount" type="number" step="0.01" required placeholder="0.00" className="w-full text-3xl font-bold text-center border-b-2 p-4 mb-4 outline-none bg-transparent" />
              <input name="desc" required placeholder="备注" className="w-full border border-slate-300 rounded-lg p-3 mb-6 outline-none" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddTxModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSettleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl w-96 shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-center">确认结算?</h3>
            <p className="text-slate-500 text-sm mb-6 text-center">余额 <span className="font-bold">{currentBoardBalance}</span> 将退还给父账本。</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowSettleModal(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg">取消</button>
              <button onClick={handleSettleBoard} className="px-4 py-2 bg-indigo-600 text-white rounded-lg">确认</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}