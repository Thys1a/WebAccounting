import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// --- 诊断模式配置 (双模自动切换) ---
// 1. 优先尝试读取聊天窗口的预览配置 (Preview Config)
// 2. 如果没有，则尝试读取 Vite 环境变量 (Production/Local Config)

let firebaseConfig = null;
let envSource = "未知";

// 尝试获取预览环境配置
try {
  // @ts-ignore
  if (typeof __firebase_config !== 'undefined') {
    firebaseConfig = JSON.parse(__firebase_config);
    envSource = "Preview Mode (Chat Window)";
    console.log("✅ [DIAGNOSTIC] Loaded Preview Config");
  }
} catch (e) {
  // Ignore
}

// 如果没有预览配置，尝试获取生产环境配置 (.env)
if (!firebaseConfig) {
  try {
    // 使用 try-catch 和条件检查来避免预览环境编译报错
    // @ts-ignore
    if (import.meta && import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) {
      firebaseConfig = {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID
      };
      envSource = "Local/Production (.env)";
      console.log("✅ [DIAGNOSTIC] Loaded Local .env Config");
    }
  } catch (e) {
    console.warn("⚠️ Local config check skipped.");
  }
}

// 如果都读取失败
if (!firebaseConfig) {
  console.error("❌ No Firebase config found.");
  firebaseConfig = {}; 
  envSource = "Error: No Config Found";
}

let app, auth, db;
let initError = null;

try {
  // 只有配置存在才初始化，防止崩溃
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("✅ [DIAGNOSTIC] Firebase 初始化成功");
  } else {
    throw new Error("配置为空，无法初始化");
  }
} catch (e) {
  console.error("❌ [DIAGNOSTIC] Firebase 初始化失败:", e);
  initError = e.message;
}

export default function App() {
  const [status, setStatus] = useState('初始化中...');
  const [user, setUser] = useState(null);
  const [logs, setLogs] = useState([]);

  const addLog = (msg) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  useEffect(() => {
    if (initError) {
      setStatus(`初始化错误: ${initError}`);
      addLog(`❌ 初始化失败: ${initError}`);
      return;
    }

    if (!auth) {
      setStatus("配置无效");
      return;
    }

    // 尝试匿名登录
    addLog("正在尝试登录...");
    signInAnonymously(auth).catch(e => {
        addLog(`❌ 登录失败: ${e.message}`);
        console.error(e);
    });

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        setStatus("已登录，准备就绪");
        addLog(`✅ 用户已登录: ${u.uid}`);
      } else {
        setStatus("未登录");
      }
    });
    return () => unsubscribe();
  }, []);

  const handleTestWrite = async () => {
    if (!user) return alert("请等待登录完成");
    if (!db) return alert("数据库连接失败");
    
    addLog("🚀 开始写入测试数据...");
    try {
      // 1. 写入根目录的 test_collection (最简单的路径)
      const docRef = await addDoc(collection(db, "test_collection"), {
        msg: "Hello Firebase",
        user: user.uid,
        time: serverTimestamp(),
        browser: navigator.userAgent,
        env: envSource
      });
      addLog(`🎉 写入成功！文档ID: ${docRef.id}`);
      addLog(`👉 请去 Firebase Console 查找 "test_collection" 集合`);
    } catch (e) {
      addLog(`❌ 写入失败: ${e.message}`);
      console.error("写入详细错误:", e);
      if (e.code === 'permission-denied') {
         addLog("💡 提示：请检查 Firestore Rules 是否已设为公开 (allow read, write: if true;)");
      }
    }
  };

  return (
    <div className="p-10 max-w-2xl mx-auto font-mono bg-white min-h-screen text-slate-800">
      <h1 className="text-2xl font-bold mb-4">Firebase 连接诊断器</h1>
      
      <div className={`p-4 rounded mb-6 border-l-4 ${envSource.includes('Preview') ? 'bg-yellow-50 border-yellow-400' : 'bg-green-50 border-green-500'}`}>
        <p className="font-bold">当前环境: {envSource}</p>
        <p className="text-sm mt-1 text-slate-600">
          {envSource.includes('Preview') 
            ? "⚠️ 注意：您现在连接的是测试数据库。要测试您自己的 Firebase，请下载代码并在本地运行。" 
            : "✅ 正常：正在使用本地 .env 配置。"}
        </p>
      </div>
      
      <div className="bg-slate-100 p-4 rounded mb-6 text-sm">
        <p><strong>状态:</strong> {status}</p>
        <p><strong>Project ID:</strong> {firebaseConfig.projectId || "未读取到"}</p>
        <p><strong>User ID:</strong> {user?.uid || "..."}</p>
      </div>

      <button 
        onClick={handleTestWrite}
        disabled={!user}
        className="bg-blue-600 text-white px-6 py-3 rounded hover:bg-blue-700 font-bold mb-6 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        写入一条测试数据
      </button>

      <div className="border border-slate-300 p-4 h-64 overflow-y-auto bg-black text-green-400 rounded font-mono text-xs">
        {logs.length === 0 && <div className="text-gray-500 italic">等待日志...</div>}
        {logs.map((log, i) => <div key={i}>{log}</div>)}
      </div>

      <div className="mt-6 text-sm text-slate-500">
        <h3 className="font-bold mb-2">如何使用本诊断器：</h3>
        <ol className="list-decimal pl-5 space-y-1">
          <li>如果上方显示 <strong>Preview Mode</strong>，说明此时写入的数据<strong>不在您的数据库里</strong>。</li>
          <li>请点击右上角下载代码，在本地运行 <code>npm run dev</code>。</li>
          <li>本地运行后，如果显示 <strong>Local/Production</strong> 且 <strong>Project ID</strong> 是您自己的，再点击写入。</li>
          <li>如果写入失败，请把黑色框里的报错发给开发者。</li>
        </ol>
      </div>
    </div>
  );
}