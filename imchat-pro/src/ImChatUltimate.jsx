
import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, 
  Wallet, 
  Settings, 
  LogOut, 
  Send, 
  User, 
  Lock, 
  Plus,
  Mic,
  StopCircle,
  Play,
  Pause,
  ArrowRight, // Для мобильной навигации
  ArrowLeft   // Для мобильной навигации
} from 'lucide-react';

// === ДОБАВИТЬ ЭТИ 2 СТРОКИ ===
import { useWeb3Modal } from '@web3modal/wagmi/react';
import { useAccount } from 'wagmi'; 
// =============================

// Утилита: Преобразование строки в HEX
const toHex = (string) => {
  return '0x' + Array.from(string, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
};

const isValidAddress = (address) => /^0x[a-fA-F0-9]{40}$/.test(address);

// --- 1. Crypto Service (E2E Шифрование) ---
const CryptoService = {
  deriveKey: async (signature) => {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      enc.encode(signature),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("imchat-production-salt"),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  },

  encrypt: async (text, key) => {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoded
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
  },

  decrypt: async (encryptedBase64, key) => {
    try {
      const combined = new Uint8Array(atob(encryptedBase64).split("").map(c => c.charCodeAt(0)));
      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
      );
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      // console.error("Decryption err:", e);
      return "🔒 [Decryption Error]";
    }
  }
};

// --- 2. Node Storage (Имитация IPFS/Local Storage) ---
const NodeStorage = {
  getDB: () => JSON.parse(localStorage.getItem('imchat_db_v2') || '{}'),
  saveDB: (db) => localStorage.setItem('imchat_db_v2', JSON.stringify(db)),
  
  saveMessage: (chatId, encryptedPayload) => {
    const db = NodeStorage.getDB();
    if (!db[chatId]) db[chatId] = [];
    db[chatId].push(encryptedPayload);
    NodeStorage.saveDB(db);
  },
  
  fetchMessages: (chatId) => {
    const db = NodeStorage.getDB();
    return db[chatId] || [];
  },

  getProfiles: () => JSON.parse(localStorage.getItem('imchat_profiles_v2') || '{}'),
  saveProfile: (address, data) => {
    const profiles = NodeStorage.getProfiles();
    profiles[address.toLowerCase()] = data;
    localStorage.setItem('imchat_profiles_v2', JSON.stringify(profiles));
  },
  // ImChatUltimate.jsx (примерно строки 106-110)

  getProfile: (address) => {
    // >>> ИСПРАВЛЕНИЕ: Добавляем проверку на null или undefined
    if (!address) {
      return { name: 'Web3 User', avatar: '' };
    }
    // <<< ИСПРАВЛЕНИЕ ЗАКОНЧЕНО

    const profiles = NodeStorage.getProfiles();
    return profiles[address.toLowerCase()] || { name: `User ${address?.slice(0,6)}`, avatar: '' };
  }
};

// --- 3. Audio Message Component ---
const AudioMessage = ({ base64Audio, isMe }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);
  const [audioUrl, setAudioUrl] = useState(null);

  useEffect(() => {
    if (base64Audio) {
      try {
        const binary = atob(base64Audio);
        const array = new Uint8Array(binary.length);
        for(let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
        const blob = new Blob([array], { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        audioRef.current = new Audio(url);
        audioRef.current.onended = () => setIsPlaying(false);
      } catch (e) {
        console.error("Audio decode error", e);
      }
    }
  }, [base64Audio]);

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };
  
  const iconColor = isMe ? 'text-blue-200' : 'text-gray-400';

  return (
    <div className="flex items-center gap-2 min-w-[150px] p-1 rounded-lg">
      <button onClick={togglePlay} className={`${iconColor} hover:opacity-80 transition`}>
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
      <div className="h-1 flex-1 bg-white/20 rounded-full overflow-hidden">
        <div className={`h-full bg-blue-400 transition-all ${isPlaying ? 'animate-pulse w-full' : 'w-1/2'}`} />
      </div>
      <span className={`text-[10px] font-mono ${iconColor} opacity-70`}>Voice</span>
    </div>
  );
};


// --- 4. Main App Component ---

export default function ImChatUltimate() {
  const [account, setAccount] = useState(null);
  const [key, setKey] = useState(null);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [friends, setFriends] = useState([]);
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [myProfile, setMyProfile] = useState(NodeStorage.getProfile(null) || { name: 'Web3 User', avatar: '' });
  
  // Mobile UI State: true = list view, false = chat view (for small screens)
  const [isListView, setIsListView] = useState(true);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [recTime, setRecTime] = useState('0:00');
  const recIntervalRef = useRef(null);

  const messagesEndRef = useRef(null);

const { open } = useWeb3Modal(); // Хук для открытия модального окна
  const { address, isConnected } = useAccount(); // Хук для проверки статуса

  const handleConnect = () => {
    // Эта функция открывает Web3Modal, который сам выбирает метод
    open(); 
  };
  

  // Initial Load & Listeners
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('imchat_friends_list') || '[]');
    setFriends(saved);

    const handleAccountsChanged = (accs) => {
      if (accs.length === 0 || (accs.length > 0 && accs[0].toLowerCase() !== account)) disconnect();
    };
    
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged);
    }
    
    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      }
    };
  }, [account]);

  // Mobile View Toggle Logic
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768 && activeChat) {
        setIsListView(false);
      } else {
        setIsListView(true);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check

    return () => window.removeEventListener('resize', handleResize);
  }, [activeChat]);

  // --- WALLET / AUTH LOGIC ---
  const connectWallet = async () => {
    if (!window.ethereum) {
      console.error("MetaMask not installed!");
      return;
    }
    
    setLoading(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts[0].toLowerCase();
      
      const message = `Login to ImChat Pro\n\nUser: ${address}\nNonce: ${Date.now()}\n\nSign this to generate your encryption key.`;
      const msgHex = toHex(message);

      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [msgHex, address],
      });

      const derivedKey = await CryptoService.deriveKey(signature);
      
      setAccount(address);
      setKey(derivedKey);

      const profile = NodeStorage.getProfile(address);
      setMyProfile(profile || { name: `User ${address.slice(0,6)}`, avatar: '' });

    } catch (err) {
      console.error("Connection Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    setAccount(null);
    setKey(null);
    setActiveChat(null);
    setMessages([]);
    setMyProfile({ name: 'Web3 User', avatar: '' });
  };

  // --- CHAT LOGIC ---
  const getChatId = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('_');

  // Message Polling
  useEffect(() => {
    let interval;
    const loadMessages = async () => {
      if (!account || !key || !activeChat) return;

      const chatId = getChatId(account, activeChat);
      const raw = NodeStorage.fetchMessages(chatId);
      
      const decrypted = await Promise.all(raw.map(async (msg) => {
        let content = await CryptoService.decrypt(msg.content, key);
        return { ...msg, text: content };
      }));

      // Only update if changes were detected
      if (JSON.stringify(messages.map(m => m.id)) !== JSON.stringify(decrypted.map(m => m.id))) {
        setMessages(decrypted);
      }
    };

    if (account && key && activeChat) {
      loadMessages();
      interval = setInterval(loadMessages, 1500); // Polling interval
    }
    return () => clearInterval(interval);
  }, [account, key, activeChat]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  
  // Select Recipient
  const selectRecipient = (addr) => {
    setActiveChat(addr);
    if (window.innerWidth < 768) {
      setIsListView(false);
    }
  };

  // Send Logic
  const processAndSend = async (content, type) => {
    if (!activeChat || !key) return;
    try {
      const encrypted = await CryptoService.encrypt(content, key);
      const payload = {
        id: Date.now(),
        sender: account,
        content: encrypted,
        type: type,
        timestamp: Date.now()
      };

      const chatId = getChatId(account, activeChat);
      NodeStorage.saveMessage(chatId, payload);
      
      // Instant UI update (shows unencrypted message locally)
      setMessages(prev => [...prev, { ...payload, text: content }]);
    } catch (e) {
      console.error("Send error:", e);
    }
  };

  const sendMessage = async () => {
    if (!inputVal.trim() || !activeChat) return;
    const text = inputVal;
    setInputVal('');
    await processAndSend(text, 'text');
  };

  // --- AUDIO RECORDING ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      setMediaRecorder(recorder);
      setAudioChunks([]);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) setAudioChunks((prev) => [...prev, e.data]);
      };

      recorder.onstart = () => {
        setIsRecording(true);
        startRecordingTimer();
      };
      
      recorder.start();
    } catch (e) {
      console.error("Microphone access error:", e); 
    }
  };

  const stopRecording = (cancel = false) => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      
      clearInterval(recIntervalRef.current);
      setRecTime('0:00');
      
      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        if (cancel || audioChunks.length === 0) {
            setAudioChunks([]);
            return;
        }

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64data = reader.result.split(',')[1];
          await processAndSend(base64data, 'audio');
          setAudioChunks([]);
        };
      };
    }
  };
  
  const startRecordingTimer = () => {
    const startTime = Date.now();
    clearInterval(recIntervalRef.current);
    recIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        setRecTime(`${minutes}:${seconds < 10 ? '0' : ''}${seconds}`);
    }, 1000);
  };

  // --- FRIEND & PROFILE MANAGEMENT ---
  const addFriend = () => {
    const addr = prompt("Enter friend's MetaMask address (0x...):");
    if (!addr) return;
    if (!isValidAddress(addr)) return console.error("Invalid address");
    
    const norm = addr.toLowerCase();
    if (norm === account) return console.error("Cannot add self");
    if (friends.includes(norm)) return console.error("Already in list");

    const newList = [...friends, norm];
    setFriends(newList);
    localStorage.setItem('imchat_friends_list', JSON.stringify(newList));
    selectRecipient(norm);
  };

  const saveProfile = () => {
    NodeStorage.saveProfile(account, myProfile);
    setIsProfileOpen(false);
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setMyProfile(prev => ({ ...prev, avatar: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  // --- UI COMPONENTS ---
  
  // Profile Modal (Component)
  const ProfileModal = ({ profile, setProfile, onSave, onClose, onAvatarUpload, account }) => (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4">
        <div className="bg-[#101525] p-6 rounded-xl shadow-2xl w-full max-w-md border border-[#1C243B]">
            <h3 className="text-xl font-bold mb-4 text-white">Profile Settings</h3>
            
            <div className="flex flex-col items-center mb-6">
                <label className="relative cursor-pointer group">
                  {profile.avatar ? (
                    <img src={profile.avatar} className="w-24 h-24 rounded-full mb-3 object-cover border-4 border-blue-500" alt="Avatar Preview" />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-blue-500/50 flex items-center justify-center text-white mb-3 border-4 border-blue-500">
                      <User size={32}/>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <span className="text-xs text-white">Change</span>
                  </div>
                  <input type="file" className="hidden" accept="image/*" onChange={onAvatarUpload}/>
                </label>
                <p className="text-xs font-mono text-gray-400 break-all mb-2">{account || 'N/A'}</p>
            </div>

            <div className="mb-4">
                <label htmlFor="display-name-input" className="block text-sm font-medium text-gray-300 mb-1">Display Name</label>
                <input type="text" id="display-name-input" placeholder="Enter your name"
                       value={profile.name}
                       onChange={e => setProfile({...profile, name: e.target.value})}
                       className="w-full p-2 rounded-lg bg-[#1C243B] border border-[#1C243B] text-white focus:ring-1 focus:ring-blue-500 focus:outline-none"/>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
                <button onClick={onClose} className="py-2 px-4 rounded-lg text-gray-300 hover:bg-[#1C243B] transition">
                    Close
                </button>
                <button onClick={onSave} className="py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition">
                    Save
                </button>
            </div>
        </div>
    </div>
  );


  // --- MAIN RENDER ---

// ImChatUltimate.jsx (Найдите старый блок if (!account) и замените его целиком)

// Используем isConnected из Wagmi для проверки статуса
if (!isConnected) {
  return (
    <div className="min-h-screen bg-[#040816] text-white flex items-center justify-center p-4">
      <style dangerouslySetInnerHTML={{
        __html: `
          .app-window { background-color: #101525; border-radius: 18px; box-shadow: 0 15px 50px rgba(0, 0, 0, 0.7); }
          .sidebar { background-color: #0F1321; }
          .input-bg { background-color: #1C243B; }
        `}}
      />
      <div className="app-window max-w-md w-full border border-white/10 p-8 rounded-3xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500" />
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-500/30">
            <Shield size={32} className="text-blue-500" />
          </div>
          <h1 className="text-3xl font-bold mb-2">ImChat Pro</h1>
          <p className="text-gray-400 text-sm">Decentralized. Encrypted. Universal Wallet Auth.</p>
        </div>
        <button 
          // 🛑 НОВАЯ ЛОГИКА: Вызываем open() для открытия Web3Modal
          onClick={() => open()}
          // 🛑 Убрано disabled={loading}, так как Web3Modal сам управляет состоянием
          className="w-full py-4 bg-gradient-to-r from-blue-700 to-blue-600 hover:from-blue-600 hover:to-blue-500 rounded-xl font-bold text-sm transition shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2"
        >
          {/* 🛑 Убрана проверка loading. Всегда показываем кнопку подключения. */}
          <Wallet size={18} /> Connect Wallet
        </button>
      </div>
    </div>
  );
}

  // Main App Screen
  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-[#040816] font-sans">
      
      {/* Dynamic Style injection for first code's look */}
      <style dangerouslySetInnerHTML={{
        __html: `
          .app-window { background-color: #101525; border-radius: 18px; box-shadow: 0 15px 50px rgba(0, 0, 0, 0.7); width: 95%; max-width: 1200px; height: 90vh; min-height: 600px; display: flex; overflow: hidden; }
          .message-local { background-color: #007AFF; } 
          .message-remote { background-color: #2D3340; } 
          .sidebar { background-color: #0F1321; } 
          .input-bg { background-color: #1C243B; }
          .user-active { background-color: #007AFF; }
          .user-active:hover { background-color: #0069E0; }
          @media (max-width: 768px) {
              .app-window { flex-direction: column; }
              .sidebar { width: 100%; height: 100%; border-right: none; }
              .chat-area { width: 100%; height: 100%; }
          }
        `}}
      />
      
      {/* Main App Window */}
      <div className="app-window">

        {/* Left Side: Users and Navigation */}
        <div className={`sidebar md:w-1/3 max-w-sm flex-col ${isListView ? 'flex' : 'hidden md:flex'}`}>
          
          <div className="p-3 border-b border-[#1C243B] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Chats</h2>
            <button onClick={() => setIsProfileOpen(true)} className="text-gray-400 hover:text-blue-400 transition p-1">
              <Settings size={18} />
            </button>
          </div>
          
          {/* MetaMask Status */}
          <div className="p-3 border-b border-[#1C243B]">
            <div className="flex items-center justify-between p-2 -m-2 rounded-lg">
              <div className="flex items-center gap-3">
                {myProfile.avatar ? (
                  <img src={myProfile.avatar} className="w-8 h-8 rounded-full object-cover border border-blue-500" alt="Avatar" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-500/50 flex items-center justify-center text-white"><User size={16}/></div>
                )}
                <div className="flex flex-col">
                  <p className="font-semibold text-sm truncate">{myProfile.name}</p>
                  <span className="text-xs text-gray-500 font-mono truncate">{account.substring(0, 10)}...</span>
                </div>
              </div>
              <button onClick={disconnect} 
                      className="py-1 px-2 text-xs rounded-full bg-red-600 hover:bg-red-700 text-white font-semibold transition">
                Logout
              </button>
            </div>
          </div>

          {/* Users List */}
          <ul id="users-list" className="flex-grow overflow-y-auto px-3 py-3 space-y-1">
            {friends.length === 0 && <li className="p-3 text-sm text-gray-500">Add MetaMask ID below.</li>}
            {friends.map(addr => {
              const p = NodeStorage.getProfile(addr);
              const isActive = activeChat === addr;
              return (
                <li key={addr} onClick={() => selectRecipient(addr)} 
                    className={`user-item flex items-center gap-3 ${isActive ? 'user-active' : 'hover:bg-[#1C243B]'}`}>
                  <div className="w-8 h-8 rounded-full bg-[#1E40AF]/50 flex items-center justify-center text-xs font-bold text-gray-400">
                    {addr.substring(2,4).toUpperCase()}
                  </div>
                  <div className="flex flex-col overflow-hidden flex-grow">
                    <span className="font-semibold text-sm truncate">{p?.name || 'User ' + addr.substring(0,6)}</span>
                    <span className="text-xs text-gray-400 font-mono truncate">{addr.substring(0, 10)}...</span>
                  </div>
                  {isActive && <Lock size={12} className="text-white/70"/>}
                </li>
              );
            })}
          </ul>
          
          {/* Add New User */}
          <div className="p-3 border-t border-[#1C243B]">
            <div className="flex gap-2">
              <input type="text" id="add-user-input" placeholder="Add ID (MetaMask Address)..."
                     className="flex-grow p-2 text-sm rounded-lg input-bg border border-transparent text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"/>
              <button onClick={addFriend} className="py-2 px-3 text-sm bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition duration-150">
                <Plus size={16}/>
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Chat Window */}
        <div className={`flex-grow flex flex-col bg-[#0A0D1A] ${!isListView ? 'flex' : 'hidden md:flex'}`}>
          
          {/* Chat Header */}
          <div id="chat-header" className="p-4 border-b border-[#1C243B] h-[60px] flex items-center justify-between">
            <button onClick={() => setIsListView(true)} className="md:hidden text-gray-400 hover:text-blue-400 transition mr-3">
              <ArrowLeft size={18} />
            </button>
            <h3 id="current-chat-name" className="text-lg font-bold text-white">
              {activeChat ? NodeStorage.getProfile(activeChat)?.name || activeChat.substring(0,8)+'...' : '👋 Select Recipient'}
            </h3>
            {activeChat && <span className="text-xs text-gray-500 font-mono flex items-center gap-1"><Lock size={8}/> E2E</span>}
          </div>
          
          {/* Messages */}
          <div id="chat-container" className="flex-grow p-6 space-y-4 overflow-y-auto">
            {!activeChat ? (
              <p id="initial-message" className="text-center text-gray-500 mt-10">
                Connect your MetaMask and select a recipient to start a chat.
              </p>
            ) : (
              <>
                {messages.map(msg => {
                  const isMe = msg.sender === account;
                  const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} my-2`}>
                      <div className={`max-w-[70%] p-3 text-sm flex flex-col gap-1 rounded-xl ${isMe ? 'message-local ml-auto rounded-br-none' : 'message-remote mr-auto rounded-bl-none'}`}>
                        {msg.type === 'audio' ? (
                          <AudioMessage base64Audio={msg.text} isMe={isMe} />
                        ) : (
                          <p className="text-base break-words">{msg.text}</p>
                        )}
                        <span className={`text-xs opacity-80 text-right ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>{time}</span>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef}/>
              </>
            )}
          </div>

          {/* Input */}
          <div id="input-area" className="p-4 border-t border-[#1C243B] h-auto">
            <div className="flex space-x-3 items-center">
              
              {/* Input Wrapper (Text or Recording Status) */}
              <div id="input-wrapper" className="flex-grow flex items-center h-10">
                {isRecording ? (
                  <div id="recording-status" className="flex-grow flex items-center justify-between p-2 rounded-xl input-bg h-full">
                    <span className="text-red-400 font-semibold flex items-center gap-2">
                       <StopCircle size={16} className="animate-pulse"/> Recording... <span id="rec-time">{recTime}</span>
                    </span>
                    <button onClick={() => stopRecording(true)} className="text-gray-400 hover:text-white" title="Cancel">
                      <StopCircle size={18}/>
                    </button>
                  </div>
                ) : (
                  <input type="text" id="message-input" placeholder="Enter message..."
                         value={inputVal}
                         onChange={e => setInputVal(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && sendMessage()}
                         disabled={!activeChat}
                         className={`flex-grow p-3 rounded-xl input-bg border border-transparent text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${!activeChat ? 'disabled:opacity-50' : ''}`}
                  />
                )}
              </div>

              {/* Mic/Send Button */}
              {inputVal.trim() && !isRecording ? (
                <button onClick={sendMessage} disabled={!activeChat}
                        className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed">
                  <Send size={18} />
                </button>
              ) : (
                <button 
                  onClick={isRecording ? () => stopRecording(false) : startRecording} 
                  disabled={!activeChat}
                  className={`w-10 h-10 flex items-center justify-center rounded-full transition disabled:opacity-50 ${isRecording ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' : 'bg-gray-600 hover:bg-gray-700 text-white'}`} 
                  title="Voice Message"
                >
                  {isRecording ? <StopCircle size={18}/> : <Mic size={18}/>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Profile Modal Render */}
      {isProfileOpen && (
        <ProfileModal
          profile={myProfile}
          setProfile={setMyProfile}
          onSave={saveProfile}
          onClose={() => setIsProfileOpen(false)}
          onAvatarUpload={handleAvatarUpload}
          account={account}
        />
      )}
    </div>
  );
}
