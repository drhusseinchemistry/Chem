
import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, update, push, child, get, onDisconnect, remove } from 'firebase/database';
import { Peer } from 'peerjs'; // Re-import PeerJS for Audio
import { defaultQuizData } from './data';
import './Game.css';
import { Mic, MicOff, Phone, Share2, Settings, Video, VideoOff } from 'lucide-react';

interface Player {
  id: string;
  name: string;
  team: 1 | 2;
  isHost: boolean;
  peerId?: string; // Add peerId for voice
}

interface GameState {
  ropePosition: number;
  winnerName: string | null;
  gameStarted: boolean;
  team1: {
      questionIndex: number;
      shuffledOptions: string[];
      score: number; // Add score tracking
  };
  team2: {
      questionIndex: number;
      shuffledOptions: string[];
      score: number; // Add score tracking
  };
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
  const [team1State, setTeam1State] = useState<{q: any, options: string[], score: number} | null>(null);
  const [team2State, setTeam2State] = useState<{q: any, options: string[], score: number} | null>(null);
  
  const [isAnswered, setIsAnswered] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  
  const lastQuestionIndexRef = useRef<number>(-1);

  // Voice/Video Chat State
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [hasLocalStream, setHasLocalStream] = useState(false); // Track if stream is active
  const [mediaError, setMediaError] = useState<string | null>(null); // Track permission errors
  const [expandedVideo, setExpandedVideo] = useState<'local' | 'remote' | null>(null); // For fullscreen video
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const activeCallRef = useRef<any>(null); // Track active call to replace tracks

  const setupLocalStream = async (enableVideo = false) => {
      try {
          // If we already have the desired state, return current stream
          // But if we want video and current stream doesn't have it, we need to upgrade
          const currentHasVideo = localStream.current?.getVideoTracks().length > 0;
          if (localStream.current && (currentHasVideo === enableVideo)) {
              return localStream.current;
          }
          
          setMediaError(null);
          let stream: MediaStream;
          
          try {
              if (enableVideo) {
                  // High Quality Video
                  stream = await navigator.mediaDevices.getUserMedia({ 
                      audio: true, 
                      video: { 
                          facingMode: "user",
                          width: { ideal: 1280 },
                          height: { ideal: 720 }
                      } 
                  });
                  setIsVideoOff(false);
              } else {
                  // Audio Only initially
                  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                  setIsVideoOff(true);
              }
          } catch (err) {
              console.warn("Media access failed", err);
              // Fallback logic could go here
              if (enableVideo) {
                   // Try without high res constraints if that failed
                   try {
                       stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                   } catch (e) {
                       setMediaError("Camera denied");
                       return null;
                   }
              } else {
                  setMediaError("Mic denied");
                  return null;
              }
          }

          // Stop old tracks if replacing
          if (localStream.current) {
              localStream.current.getTracks().forEach(t => t.stop());
          }

          localStream.current = stream;
          setHasLocalStream(true);
          
          if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
              localVideoRef.current.muted = true;
          }

          // Update active call if exists
          if (activeCallRef.current && activeCallRef.current.peerConnection) {
              const pc = activeCallRef.current.peerConnection;
              const senders = pc.getSenders();
              
              stream.getTracks().forEach(track => {
                  const sender = senders.find((s: any) => s.track?.kind === track.kind);
                  if (sender) {
                      sender.replaceTrack(track);
                  } else {
                      // If adding a new track type (e.g. video to audio-only call), we might need to renegotiate
                      // PeerJS doesn't handle renegotiation easily. 
                      // Simple workaround: If we add video, we might need to re-call.
                      // But let's try replaceTrack first. 
                      // If sender is missing (e.g. no video sender), we can't just add it without renegotiation.
                      if (track.kind === 'video') {
                          // We need to add a transceiver or just re-call
                          console.log("Adding video track to existing call...");
                          // For now, let's rely on the user clicking "Connect" again if video doesn't show, 
                          // or we can force a re-call here if we know the peerId.
                      }
                  }
              });
          }

          return stream;
      } catch (err) {
          console.error("Failed to get local stream", err);
          setMediaError("Access denied");
          setHasLocalStream(false);
          return null;
      }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      localStream.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  // --- Initialization ---

  useEffect(() => {
    // Initialize PeerJS for Voice/Video
    const peer = new Peer({
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    });
    peerRef.current = peer;

    peer.on('open', (id) => {
        console.log("My Peer ID:", id);
        setMyPeerId(id);
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        setMediaError("Connection Error: " + err.type);
    });

    peer.on('call', async (call) => {
        let stream = localStream.current;
        if (!stream) {
            stream = await setupLocalStream();
        }
        if (stream) {
            call.answer(stream);
            call.on('stream', (remoteStream) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = remoteStream;
                    // Ensure we try to play it
                    remoteVideoRef.current.play().catch(e => console.error("Auto-play failed", e));
                }
            });
            setIsVoiceConnected(true);
        }
    });

    return () => {
        peer.destroy();
    };
  }, []);

  // ... (Firebase Init) ...

  // ... (Game Logic) ...

  const connectVoice = async (remotePeerId: string) => {
      console.log("Connecting to:", remotePeerId);
      
      let stream = localStream.current;
      if (!stream) {
          stream = await setupLocalStream(false); // Default to audio only
      }
      
      if (stream && peerRef.current) {
          try {
              const call = peerRef.current.call(remotePeerId, stream);
              activeCallRef.current = call;
              
              call.on('stream', (remoteStream) => {
                  console.log("Received remote stream");
                  if (remoteVideoRef.current) {
                      remoteVideoRef.current.srcObject = remoteStream;
                      remoteVideoRef.current.play().catch(e => console.error("Auto-play failed", e));
                  }
              });
              
              call.on('error', (err) => {
                  console.error("Call error:", err);
                  setMediaError("Call failed");
              });

              setIsVoiceConnected(true);
          } catch (e) {
              console.error("Call failed to start", e);
          }
      }
  };

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

                      // Auto-connect voice if both present
                      if (playerList.length === 2 && myPeerId) {
                          const opponent = playerList.find(p => p.id !== myId);
                          // Host initiates call, Guest waits for call
                          if (opponent && opponent.peerId && !isVoiceConnected && me.isHost) {
                              connectVoice(opponent.peerId);
                          }
                      }

                      // Auto-start game if 2 players are present and I am the host
                      if (me.isHost && playerList.length === 2 && !data.gameState?.gameStarted) {
                          // Small delay to ensure UI updates first
                          setTimeout(() => {
                              update(ref(db, `rooms/${roomId}/gameState`), {
                                  gameStarted: true
                              });
                              
                              // Load first question for Team 1
                              const idx1 = Math.floor(Math.random() * defaultQuizData.length);
                              const q1 = defaultQuizData[idx1];
                              const opts1 = [...q1.options];
                              for (let i = opts1.length - 1; i > 0; i--) {
                                  const j = Math.floor(Math.random() * (i + 1));
                                  [opts1[i], opts1[j]] = [opts1[j], opts1[i]];
                              }
                              
                              // Load first question for Team 2
                              const idx2 = Math.floor(Math.random() * defaultQuizData.length);
                              const q2 = defaultQuizData[idx2];
                              const opts2 = [...q2.options];
                              for (let i = opts2.length - 1; i > 0; i--) {
                                  const j = Math.floor(Math.random() * (i + 1));
                                  [opts2[i], opts2[j]] = [opts2[j], opts2[i]];
                              }
                              
                              update(ref(db, `rooms/${roomId}/gameState`), {
                                  team1: { questionIndex: idx1, shuffledOptions: opts1, score: 0 },
                                  team2: { questionIndex: idx2, shuffledOptions: opts2, score: 0 }
                              });
                          }, 1000);
                      }
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
                  
                  // Sync Question for Team 1
                  if (data.gameState.team1) {
                      const idx = data.gameState.team1.questionIndex;
                      const q = defaultQuizData[idx];
                      if (q) {
                          setTeam1State({ 
                              q, 
                              options: data.gameState.team1.shuffledOptions || [],
                              score: data.gameState.team1.score || 0
                          });
                      }
                  }

                  // Sync Question for Team 2
                  if (data.gameState.team2) {
                      const idx = data.gameState.team2.questionIndex;
                      const q = defaultQuizData[idx];
                      if (q) {
                          setTeam2State({ 
                              q, 
                              options: data.gameState.team2.shuffledOptions || [],
                              score: data.gameState.team2.score || 0
                          });
                      }
                  }
                  
                  // Reset local answer state if MY question changed
                  const myCurrentIndex = myTeam === 1 ? data.gameState.team1?.questionIndex : data.gameState.team2?.questionIndex;
                  if (myCurrentIndex !== undefined && myCurrentIndex !== lastQuestionIndexRef.current) {
                      setIsAnswered(false);
                      setSelectedOption(null);
                      setIsCorrect(null);
                      lastQuestionIndexRef.current = myCurrentIndex;
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
          isHost: true,
          peerId: myPeerId
      };

      const initialGameState: GameState = {
          ropePosition: 50,
          winnerName: null,
          gameStarted: false,
          team1: { questionIndex: 0, shuffledOptions: [], score: 0 },
          team2: { questionIndex: 0, shuffledOptions: [], score: 0 }
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
          isHost: false,
          peerId: myPeerId
      };

      await update(ref(db, `rooms/${roomId}/players/${myId}`), player);
      onDisconnect(ref(db, `rooms/${roomId}/players/${myId}`)).remove();
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

  const loadNextQuestionForTeam = (team: 1 | 2) => {
      const randomIndex = Math.floor(Math.random() * defaultQuizData.length);
      const q = defaultQuizData[randomIndex];
      
      // Shuffle options
      const opts = [...q.options];
      for (let i = opts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [opts[i], opts[j]] = [opts[j], opts[i]];
      }

      if (team === 1) {
          update(ref(db, `rooms/${roomId}/gameState/team1`), {
              questionIndex: randomIndex,
              shuffledOptions: opts
          });
      } else {
          update(ref(db, `rooms/${roomId}/gameState/team2`), {
              questionIndex: randomIndex,
              shuffledOptions: opts
          });
      }
  };

  const handleAnswer = (option: string) => {
      const myQ = myTeam === 1 ? team1State?.q : team2State?.q;
      if (isAnswered || !myQ) return;
      
      setIsAnswered(true);
      setSelectedOption(option);

      const correct = option === myQ.correctAnswer;
      setIsCorrect(correct);

      let delta = 0;
      if (myTeam === 1) {
          // Team 1 (Right/Blue)
          // Correct -> Moves LEFT (-5) (Pulling towards them? No, usually pulling towards means increasing/decreasing depending on axis)
          // Let's assume 0 is Left (Red) and 100 is Right (Blue).
          // If Blue pulls, rope should go to 100 (Increase).
          // User asked to REVERSE direction.
          // Previous: Correct -> +5 (Right).
          // New: Correct -> -5 (Left).
          delta = correct ? -5 : 5;
      } else {
          // Team 2 (Left/Red)
          // Previous: Correct -> -5 (Left).
          // New: Correct -> +5 (Right).
          delta = correct ? 5 : -5;
      }

      const newPos = ropePosition + delta;
      let clampedPos = Math.max(5, Math.min(95, newPos));

      update(ref(db, `rooms/${roomId}/gameState`), {
          ropePosition: clampedPos
      });

      if (clampedPos >= 90) {
          // Red wins at 90
          const newScore = (team2State?.score || 0) + 1;
           update(ref(db, `rooms/${roomId}/gameState/team2`), { score: newScore });
           
           // Reset Rope
           update(ref(db, `rooms/${roomId}/gameState`), { ropePosition: 50 });
           
           // Load NEW questions for BOTH teams to reset the round
           loadNextQuestionForTeam(1);
           loadNextQuestionForTeam(2);

      } else if (clampedPos <= 10) {
          // Blue wins at 10
          const newScore = (team1State?.score || 0) + 1;
          update(ref(db, `rooms/${roomId}/gameState/team1`), { score: newScore });
          
          // Reset Rope
          update(ref(db, `rooms/${roomId}/gameState`), { ropePosition: 50 });
          
          // Load NEW questions for BOTH teams to reset the round
          loadNextQuestionForTeam(1);
          loadNextQuestionForTeam(2);

      } else {
          // Load next question ONLY for my team
          setTimeout(() => {
              if (myTeam) loadNextQuestionForTeam(myTeam);
          }, 1000);
      }
  };

  const toggleMute = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
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

            {roomId && !isHost ? (
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
                <p style={{color: 'green'}}>Starting game automatically...</p>
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
        <div className="calc-box" style={{ opacity: myTeam === 2 ? 1 : 0.8, pointerEvents: myTeam === 2 ? 'auto' : 'none', position: 'relative' }}>
            <div style={{position: 'absolute', top: -30, left: 10, fontWeight: 'bold', color: '#c62828'}}>
                Wins: {team2State?.score || 0}
            </div>
            
            {/* Video Circle for Team 2 */}
            <div className="video-circle" onClick={() => setExpandedVideo(myTeam === 2 ? 'local' : 'remote')} style={{
                position: 'absolute',
                top: -50,
                right: 10,
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                overflow: 'hidden',
                border: '3px solid #c62828',
                background: '#000',
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                boxShadow: '0 0 15px rgba(198, 40, 40, 0.6)'
            }}>
                {/* Team 2's Video */}
                {myTeam === 2 ? (
                    <>
                        <video ref={localVideoRef} autoPlay muted playsInline style={{width: '100%', height: '100%', objectFit: 'cover', display: !isVideoOff ? 'block' : 'none'}} />
                        {isVideoOff && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); toggleVideo(); }}
                                style={{fontSize: '10px', padding: '5px', background: '#d32f2f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                            >
                                {mediaError ? "Retry" : "Enable Cam"}
                            </button>
                        )}
                    </>
                ) : (
                    <>
                        <video ref={remoteVideoRef} autoPlay playsInline style={{width: '100%', height: '100%', objectFit: 'cover'}} />
                        {!isVoiceConnected && (
                             <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const opponent = players.find(p => p.id !== myId);
                                    if (opponent?.peerId) connectVoice(opponent.peerId);
                                }}
                                style={{position: 'absolute', bottom: 5, fontSize: '8px', padding: '2px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                            >
                                Connect
                            </button>
                        )}
                    </>
                )}
            </div>

            {myTeam === 2 && (
                <div style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    zIndex: 10,
                    display: 'flex',
                    gap: '5px'
                }}>
                    <button 
                        className={`voice-btn-mini ${isMuted ? 'muted' : 'active'}`} 
                        onClick={toggleMute}
                        style={{
                            background: isMuted ? '#d32f2f' : '#4caf50',
                            border: 'none',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            cursor: 'pointer'
                        }}
                    >
                        {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    <button 
                        className={`voice-btn-mini ${isVideoOff ? 'muted' : 'active'}`} 
                        onClick={toggleVideo}
                        style={{
                            background: isVideoOff ? '#d32f2f' : '#1976d2',
                            border: 'none',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            cursor: 'pointer'
                        }}
                    >
                        {isVideoOff ? <VideoOff size={16} /> : <Video size={16} />}
                    </button>
                </div>
            )}
            <div className={`q-display red-theme ${team2State?.q && /^[A-Za-z0-9]/.test(team2State.q.text) ? 'ltr-text' : 'rtl-text'}`}>
                {team2State?.q ? team2State.q.text : "Waiting..."}
            </div>
            <div className="options-grid">
                {team2State?.options.map((opt, idx) => {
                    let btnClass = "option-btn";
                    // Only show answer feedback if I am Team 2
                    if (myTeam === 2 && isAnswered) {
                        if (opt === team2State.q.correctAnswer) btnClass += " correct-anim";
                        else if (opt === selectedOption) btnClass += " wrong-anim";
                    }
                    return (
                        <button 
                            key={idx} 
                            className={btnClass}
                            onClick={() => handleAnswer(opt)}
                            disabled={myTeam !== 2 || isAnswered}
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
        <div className="calc-box" style={{ opacity: myTeam === 1 ? 1 : 0.8, pointerEvents: myTeam === 1 ? 'auto' : 'none', position: 'relative' }}>
            <div style={{position: 'absolute', top: -30, right: 10, fontWeight: 'bold', color: '#1565c0'}}>
                Wins: {team1State?.score || 0}
            </div>
            
            {/* Video Circle for Team 1 */}
            <div className="video-circle" onClick={() => setExpandedVideo(myTeam === 1 ? 'local' : 'remote')} style={{
                position: 'absolute',
                top: -50,
                left: 10,
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                overflow: 'hidden',
                border: '3px solid #1565c0',
                background: '#000',
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                boxShadow: '0 0 15px rgba(21, 101, 192, 0.6)'
            }}>
                 {/* Team 1's Video */}
                {myTeam === 1 ? (
                    <>
                        <video ref={localVideoRef} autoPlay muted playsInline style={{width: '100%', height: '100%', objectFit: 'cover', display: !isVideoOff ? 'block' : 'none'}} />
                        {isVideoOff && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); toggleVideo(); }}
                                style={{fontSize: '10px', padding: '5px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                            >
                                {mediaError ? "Retry" : "Enable Cam"}
                            </button>
                        )}
                    </>
                ) : (
                    <>
                        <video ref={remoteVideoRef} autoPlay playsInline style={{width: '100%', height: '100%', objectFit: 'cover'}} />
                        {!isVoiceConnected && (
                             <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const opponent = players.find(p => p.id !== myId);
                                    if (opponent?.peerId) connectVoice(opponent.peerId);
                                }}
                                style={{position: 'absolute', bottom: 5, fontSize: '8px', padding: '2px', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer'}}
                            >
                                Connect
                            </button>
                        )}
                    </>
                )}
            </div>

            {myTeam === 1 && (
                <div style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    zIndex: 10,
                    display: 'flex',
                    gap: '5px'
                }}>
                    <button 
                        className={`voice-btn-mini ${isMuted ? 'muted' : 'active'}`} 
                        onClick={toggleMute}
                        style={{
                            background: isMuted ? '#d32f2f' : '#4caf50',
                            border: 'none',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            cursor: 'pointer'
                        }}
                    >
                        {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    <button 
                        className={`voice-btn-mini ${isVideoOff ? 'muted' : 'active'}`} 
                        onClick={toggleVideo}
                        style={{
                            background: isVideoOff ? '#d32f2f' : '#1976d2',
                            border: 'none',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            cursor: 'pointer'
                        }}
                    >
                        {isVideoOff ? <VideoOff size={16} /> : <Video size={16} />}
                    </button>
                </div>
            )}
            <div className={`q-display blue-theme ${team1State?.q && /^[A-Za-z0-9]/.test(team1State.q.text) ? 'ltr-text' : 'rtl-text'}`}>
                {team1State?.q ? team1State.q.text : "Waiting..."}
            </div>
            <div className="options-grid">
                {team1State?.options.map((opt, idx) => {
                    let btnClass = "option-btn";
                    // Only show answer feedback if I am Team 1
                    if (myTeam === 1 && isAnswered) {
                        if (opt === team1State.q.correctAnswer) btnClass += " correct-anim";
                        else if (opt === selectedOption) btnClass += " wrong-anim";
                    }
                    return (
                        <button 
                            key={idx} 
                            className={btnClass}
                            onClick={() => handleAnswer(opt)}
                            disabled={myTeam !== 1 || isAnswered}
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
