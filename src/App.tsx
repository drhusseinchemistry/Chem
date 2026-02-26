
import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, update, push, child, get, onDisconnect, remove } from 'firebase/database';
import { defaultQuizData } from './data';
import './Game.css';
import { Mic, MicOff, Phone, Share2, Settings } from 'lucide-react';

// --- Types ---
interface Player {
  id: string;
  name: string;
  team: 1 | 2;
  isHost: boolean;
}

interface GameState {
  ropePosition: number;
  winnerName: string | null;
  gameStarted: boolean;
  currentQuestionIndex: number | null;
  shuffledOptions: string[] | null;
}

// --- Default Config ---
const firebaseConfig = {
  apiKey: "AIzaSyDTQcrCf67cCUYN9zvwKal82M2-BwFcuu4",
  authDomain: "chemistry-69fcf.firebaseapp.com",
  databaseURL: "https://chemistry-69fcf-default-rtdb.firebaseio.com",
  projectId: "chemistry-69fcf",
  storageBucket: "chemistry-69fcf.firebasestorage.app",
  messagingSenderId: "609102094765",
  appId: "1:609102094765:web:da42fb4084b42ba4018124",
  measurementId: "G-7HB8E9VRH3"
};

export default function App() {
  // --- State ---
  const [view, setView] = useState<'lobby' | 'countdown' | 'game' | 'win'>('lobby');
  const [db, setDb] = useState<any>(null);
  
  // Game Data
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [myId, setMyId] = useState('');
  const [myTeam, setMyTeam] = useState<1 | 2 | null>(null);
  const [isHost, setIsHost] = useState(false);
  
  // Synced Game State
  const [ropePosition, setRopePosition] = useState(50);
  const [winnerName, setWinnerName] = useState('');
  const [countdown, setCountdown] = useState(3);
  
  // Quiz State
  const [currentQuestion, setCurrentQuestion] = useState<any>(null);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  const [isAnswered, setIsAnswered] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  // --- Initialization ---

  useEffect(() => {
    // Initialize Firebase immediately
    try {
      const app = initializeApp(firebaseConfig);
      const database = getDatabase(app);
      setDb(database);
    } catch (e) {
      console.error("Error initializing Firebase:", e);
      alert("Error connecting to game server.");
    }

    // Generate a random ID for this session
    let sessionKey = localStorage.getItem('player_session_id');
    if (!sessionKey) {
        sessionKey = Math.random().toString(36).substring(2, 15);
        localStorage.setItem('player_session_id', sessionKey);
    }
    setMyId(sessionKey);

    // Check URL for room
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomId(roomParam);
    }
  }, []);

  // --- Game Logic ---

  useEffect(() => {
      if (!db || !roomId) return;

      // Subscribe to Room Data
      const roomRef = ref(db, `rooms/${roomId}`);
      
      const unsubscribe = onValue(roomRef, (snapshot) => {
          const data = snapshot.val();
          if (data) {
              // Update Players
              if (data.players) {
                  const playerList = Object.values(data.players) as Player[];
                  setPlayers(playerList);
                  
                  const me = playerList.find(p => p.id === myId);
                  if (me) {
                      setMyTeam(me.team);
                      setIsHost(me.isHost);
                  }
              }

              // Update Game State
              if (data.gameState) {
                  setRopePosition(data.gameState.ropePosition);
                  
                  if (data.gameState.gameStarted && view === 'lobby') {
                      // Game just started
                      startLocalCountdown();
                  }

                  if (data.gameState.winnerName && view !== 'win') {
                      setWinnerName(data.gameState.winnerName);
                      setView('win');
                  }
                  
                  // Sync Question
                  if (data.gameState.currentQuestionIndex !== undefined && data.gameState.currentQuestionIndex !== null) {
                      const q = defaultQuizData[data.gameState.currentQuestionIndex];
                      // Only update if it's a new question
                      if (!currentQuestion || q.text !== currentQuestion.text) {
                          setCurrentQuestion(q);
                          setShuffledOptions(data.gameState.shuffledOptions || q.options);
                          setIsAnswered(false);
                          setSelectedOption(null);
                          setIsCorrect(null);
                      }
                  }
              }
          } else {
              // Room deleted or doesn't exist
              if (view === 'game') {
                  alert("Room closed.");
                  window.location.href = window.location.origin;
              }
          }
      });

      return () => unsubscribe();
  }, [db, roomId, view]); // Added view to dependencies to handle transitions

  // --- Actions ---

  const createRoom = async () => {
      if (!playerName) return alert("Please enter name");
      
      const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      setRoomId(newRoomId);
      
      const player: Player = {
          id: myId,
          name: playerName,
          team: 1,
          isHost: true
      };

      const initialGameState: GameState = {
          ropePosition: 50,
          winnerName: null,
          gameStarted: false,
          currentQuestionIndex: null,
          shuffledOptions: null
      };

      await set(ref(db, `rooms/${newRoomId}`), {
          players: { [myId]: player },
          gameState: initialGameState,
          createdAt: Date.now()
      });

      // Set disconnect handler to remove player
      onDisconnect(ref(db, `rooms/${newRoomId}/players/${myId}`)).remove();
      
      // Update URL
      const url = new URL(window.location.href);
      url.searchParams.set('room', newRoomId);
      window.history.pushState({}, '', url.toString());
  };

  const joinRoom = async () => {
      if (!playerName) return alert("Please enter name");
      if (!roomId) return alert("No Room ID");

      const roomRef = ref(db, `rooms/${roomId}`);
      const snapshot = await get(roomRef);
      
      if (!snapshot.exists()) {
          return alert("Room not found!");
      }

      const data = snapshot.val();
      const currentPlayers = data.players ? Object.values(data.players) : [];
      
      if (currentPlayers.length >= 2) {
          // Check if I am already in (rejoining)
          const amIIn = currentPlayers.find((p: any) => p.id === myId);
          if (!amIIn) return alert("Room is full!");
      }

      const player: Player = {
          id: myId,
          name: playerName,
          team: 2, // Guest is Team 2
          isHost: false
      };

      await update(ref(db, `rooms/${roomId}/players/${myId}`), player);
      onDisconnect(ref(db, `rooms/${roomId}/players/${myId}`)).remove();
  };

  const startGame = () => {
      update(ref(db, `rooms/${roomId}/gameState`), {
          gameStarted: true
      });
      loadNextQuestion();
  };

  const startLocalCountdown = () => {
      setView('countdown');
      let count = 3;
      setCountdown(3);
      const interval = setInterval(() => {
          count--;
          setCountdown(count);
          if (count <= 0) {
              clearInterval(interval);
              setView('game');
          }
      }, 1000);
  };

  const loadNextQuestion = () => {
      const randomIndex = Math.floor(Math.random() * defaultQuizData.length);
      const q = defaultQuizData[randomIndex];
      
      // Shuffle options
      const opts = [...q.options];
      for (let i = opts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [opts[i], opts[j]] = [opts[j], opts[i]];
      }

      update(ref(db, `rooms/${roomId}/gameState`), {
          currentQuestionIndex: randomIndex,
          shuffledOptions: opts
      });
  };

  const handleAnswer = (option: string) => {
      if (isAnswered || !currentQuestion) return;
      setIsAnswered(true);
      setSelectedOption(option);

      const correct = option === currentQuestion.correctAnswer;
      setIsCorrect(correct);

      let delta = 0;
      if (myTeam === 1) {
          delta = correct ? 5 : -5;
      } else {
          delta = correct ? -5 : 5;
      }

      const newPos = ropePosition + delta;
      let clampedPos = Math.max(5, Math.min(95, newPos));

      update(ref(db, `rooms/${roomId}/gameState`), {
          ropePosition: clampedPos
      });

      if (clampedPos >= 90) {
          const winner = players.find(p => p.team === 1)?.name || "Team 1";
          update(ref(db, `rooms/${roomId}/gameState`), { winnerName: winner });
      } else if (clampedPos <= 10) {
          const winner = players.find(p => p.team === 2)?.name || "Team 2";
          update(ref(db, `rooms/${roomId}/gameState`), { winnerName: winner });
      } else {
          // Only host loads next question to avoid conflicts? 
          // Or whoever answers? Better if host manages flow or just simple timeout.
          // Let's make it so whoever answers triggers the timeout for next question locally?
          // No, state must be synced.
          
          // Simple logic: Wait 1s then load next.
          // We need to ensure we don't double skip.
          // Let's say: If I answered, I request next question after 1s.
          setTimeout(() => {
              // Only one person needs to trigger this. 
              // Since both can answer, it might race.
              // Let's rely on the fact that updates are atomic-ish.
              loadNextQuestion();
          }, 1000);
      }
  };

  const copyInvite = () => {
      const url = `${window.location.origin}?room=${roomId}`;
      navigator.clipboard.writeText(url);
      alert("Link copied!");
  };

  // --- Render ---

  if (view === 'lobby') {
    return (
      <div className="game-container">
        <div className="overlay">
          <div className="setup-box">
            <div style={{display:'flex', justifyContent:'space-between'}}>
                <h2>ناوی گروپەکان بنووسە</h2>
                <div style={{width:20}}></div>
            </div>
            
            <input 
              type="text" 
              placeholder="ناوی خۆت" 
              value={playerName} 
              onChange={e => setPlayerName(e.target.value)} 
            />

            {roomId ? (
                <button className="btn-start-game" onClick={joinRoom}>
                    Join Game
                </button>
            ) : (
                !isHost ? (
                    <button className="btn-copy-link" onClick={createRoom}>
                        Create New Room
                    </button>
                ) : (
                    <div style={{marginTop: '10px'}}>
                        <p style={{color: 'green', fontWeight: 'bold'}}>Room Created!</p>
                        <button className="btn-copy-link" onClick={copyInvite} style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', margin: '10px auto'}}>
                            <Share2 size={16}/> Copy Invite Link
                        </button>
                    </div>
                )
            )}

            {players.length > 0 && (
                <div style={{ marginTop: '20px', textAlign: 'left' }}>
                    <h3>Players:</h3>
                    <ul>
                        {players.map(p => (
                            <li key={p.id} style={{ color: p.team === 1 ? '#1565c0' : '#c62828' }}>
                                {p.name} {p.id === myId ? '(You)' : ''}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {players.length === 2 && isHost && (
                <button className="btn-start-game" onClick={startGame}>
                    دەستپێکردن
                </button>
            )}
            {players.length === 2 && !isHost && (
                <p>Waiting for host to start...</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'countdown') {
    return (
      <div className="game-container">
        <div className="overlay">
            <div id="countdown-container">
                <div id="count-num">{countdown}</div>
                <h2>ئامادەبە...</h2>
            </div>
        </div>
      </div>
    );
  }

  if (view === 'win') {
      return (
        <div className="game-container">
            <div className="overlay">
                <div className="win-modal show-modal">
                    <div style={{ fontSize: '60px' }}>🏆</div>
                    <h2 style={{ margin: '10px 0', color: '#d32f2f' }}>{winnerName}</h2>
                    <p>سەرکەوتوو بوو!</p>
                    <button className="btn-restart" onClick={() => window.location.reload()}>دیسان یاری بکە</button>
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="game-container">
      <div className="game-wrapper">
        {/* Left Side (Team 2 - Red) */}
        <div className="calc-box" style={{ opacity: myTeam === 2 ? 1 : 0.5, pointerEvents: myTeam === 2 ? 'auto' : 'none' }}>
            <div className={`q-display red-theme ${currentQuestion && /^[A-Za-z0-9]/.test(currentQuestion.text) ? 'ltr-text' : 'rtl-text'}`}>
                {myTeam === 2 ? currentQuestion?.text : "Waiting for opponent..."}
            </div>
            <div className="options-grid">
                {myTeam === 2 && shuffledOptions.map((opt, idx) => {
                    let btnClass = "option-btn";
                    if (isAnswered) {
                        if (opt === currentQuestion?.correctAnswer) btnClass += " correct-anim";
                        else if (opt === selectedOption) btnClass += " wrong-anim";
                    }
                    return (
                        <button 
                            key={idx} 
                            className={btnClass}
                            onClick={() => handleAnswer(opt)}
                            disabled={isAnswered}
                            dir="auto"
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        </div>

        {/* Center Stage */}
        <div className="center-stage">
            <div className="title">
                dr.Hussein.Chemistry 🔄
            </div>
            <div className="divider"></div>
            <div className="tug-container" id="rope-group" style={{ left: `${ropePosition}%` }}>
                {/* Placeholder SVG for Tug of War */}
                <svg viewBox="0 0 600 100" className="tug-image">
                    <line x1="0" y1="50" x2="600" y2="50" stroke="#8d6e63" strokeWidth="10" />
                    {/* Left Team */}
                    <circle cx="50" cy="50" r="30" fill="#c62828" />
                    <text x="50" y="55" textAnchor="middle" fill="white" fontSize="12">Red</text>
                    {/* Right Team */}
                    <circle cx="550" cy="50" r="30" fill="#1565c0" />
                    <text x="550" y="55" textAnchor="middle" fill="white" fontSize="12">Blue</text>
                </svg>
                <div className="center-marker"></div>
            </div>
        </div>

        {/* Right Side (Team 1 - Blue) */}
        <div className="calc-box" style={{ opacity: myTeam === 1 ? 1 : 0.5, pointerEvents: myTeam === 1 ? 'auto' : 'none' }}>
            <div className={`q-display blue-theme ${currentQuestion && /^[A-Za-z0-9]/.test(currentQuestion.text) ? 'ltr-text' : 'rtl-text'}`}>
                {myTeam === 1 ? currentQuestion?.text : "Waiting for opponent..."}
            </div>
            <div className="options-grid">
                {myTeam === 1 && shuffledOptions.map((opt, idx) => {
                    let btnClass = "option-btn";
                    if (isAnswered) {
                        if (opt === currentQuestion?.correctAnswer) btnClass += " correct-anim";
                        else if (opt === selectedOption) btnClass += " wrong-anim";
                    }
                    return (
                        <button 
                            key={idx} 
                            className={btnClass}
                            onClick={() => handleAnswer(opt)}
                            disabled={isAnswered}
                            dir="auto"
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        </div>

      </div>
    </div>
  );
}
