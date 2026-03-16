import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Users, 
  History, 
  LayoutDashboard, 
  LogOut, 
  UserPlus, 
  CheckCircle2, 
  AlertCircle,
  Download,
  Search,
  Calendar as CalendarIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import * as faceapi from 'face-api.js';
import { loadModels, createFaceMatcher, warmUpModels } from './lib/face';
import { cn } from './lib/utils';

// --- Types ---
interface Student {
  id: number;
  name: string;
  student_id: string;
  face_descriptor: string;
}

interface AttendanceRecord {
  id: number;
  student_id: string;
  name: string;
  date: string;
  time: string;
}

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
      active 
        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    )}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
);

export default function App() {
  const [view, setView] = useState<'dashboard' | 'attendance' | 'students' | 'history' | 'login'>('login');
  const [user, setUser] = useState<any>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoaded, setModelsLoaded] = useState(false);

  // Auth
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Attendance Logic
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [recentDetected, setRecentDetected] = useState<Set<string>>(new Set());
  const [scanStatus, setScanStatus] = useState<string>('Initializing...');

  // Student Form
  const [newStudent, setNewStudent] = useState({ name: '', id: '' });
  const [capturing, setCapturing] = useState(false);
  const regCanvasRef = useRef<HTMLCanvasElement>(null);
  const [regFaceDetected, setRegFaceDetected] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await loadModels();
        await warmUpModels(); // Warm up models to reduce first-capture delay
        setModelsLoaded(true);
        fetchData();
      } catch (err) {
        console.error("Failed to load models", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const fetchData = async () => {
    const [sRes, aRes] = await Promise.all([
      fetch('/api/students'),
      fetch('/api/attendance')
    ]);
    setStudents(await sRes.json());
    setAttendance(await aRes.json());
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      setUser(data.user);
      setView('dashboard');
    } else {
      setAuthError(data.message);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error", err);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
  };

  useEffect(() => {
    if ((view === 'attendance' || view === 'students') && modelsLoaded) {
      startCamera();
      setIsScanning(view === 'attendance');
    } else {
      stopCamera();
      setIsScanning(false);
    }
    return () => stopCamera();
  }, [view, modelsLoaded]);

  // Face Recognition Loop
  useEffect(() => {
    let interval: any;
    if (isScanning && modelsLoaded && videoRef.current && students.length > 0) {
      const matcher = createFaceMatcher(students);
      
      interval = setInterval(async () => {
        if (!videoRef.current) return;
        
        const detections = await faceapi
          .detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 }))
          .withFaceLandmarks()
          .withFaceDescriptors();

        if (canvasRef.current && videoRef.current) {
          const displaySize = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
          faceapi.matchDimensions(canvasRef.current, displaySize);
          const resizedDetections = faceapi.resizeResults(detections, displaySize);
          
          const ctx = canvasRef.current.getContext('2d');
          ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          
          resizedDetections.forEach(detection => {
            const result = matcher.findBestMatch(detection.descriptor);
            const label = result.toString();
            
            // Draw detection box
            const drawBox = new faceapi.draw.DrawBox(detection.detection.box, { label });
            drawBox.draw(canvasRef.current!);

            if (result.label !== 'unknown' && result.distance < 0.5) {
              markAttendance(result.label);
            }
          });
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isScanning, modelsLoaded, students]);

  const markAttendance = async (studentId: string) => {
    if (recentDetected.has(studentId)) return;
    
    setRecentDetected(prev => {
      const next = new Set(prev);
      next.add(studentId);
      return next;
    });
    setScanStatus(`Recognized: ${studentId}`);
    
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId })
      });
      const data = await res.json();
      
      if (data.success) {
        fetchData();
        // Keep in recent set for 10 seconds to avoid re-triggering immediately
        setTimeout(() => {
          setRecentDetected(prev => {
            const next = new Set(prev);
            next.delete(studentId);
            return next;
          });
        }, 10000);
      }
    } catch (err) {
      console.error("Attendance error", err);
    }
  };

  // Registration Face Detection Loop
  useEffect(() => {
    let interval: any;
    if (view === 'students' && modelsLoaded && videoRef.current) {
      interval = setInterval(async () => {
        if (!videoRef.current || !regCanvasRef.current) return;
        
        const detection = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }));
        
        setRegFaceDetected(!!detection);

        const displaySize = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
        faceapi.matchDimensions(regCanvasRef.current, displaySize);
        
        const ctx = regCanvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, regCanvasRef.current.width, regCanvasRef.current.height);
        
        if (detection) {
          const resizedDetection = faceapi.resizeResults(detection, displaySize);
          faceapi.draw.drawDetections(regCanvasRef.current, resizedDetection);
        }
      }, 500);
    }
    return () => clearInterval(interval);
  }, [view, modelsLoaded]);

  const handleAddStudent = async () => {
    if (!videoRef.current || !newStudent.name || !newStudent.id) return;
    
    setCapturing(true);
    try {
      // Use SsdMobilenetv1 for registration (highest accuracy)
      const detection = await faceapi
        .detectSingleFace(videoRef.current)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection) {
        const res = await fetch('/api/students', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newStudent.name,
            student_id: newStudent.id,
            face_descriptor: Array.from(detection.descriptor)
          })
        });
        const data = await res.json();
        if (data.success) {
          setNewStudent({ name: '', id: '' });
          fetchData();
          alert("Student added successfully!");
        } else {
          alert(`Error: ${data.message}`);
        }
      } else {
        alert("No face detected. Please ensure your face is clearly visible and try again.");
      }
    } catch (err) {
      console.error("Capture error", err);
      alert("An error occurred during capture. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  const downloadCSV = () => {
    const headers = ['Student ID', 'Name', 'Date', 'Time'];
    const rows = attendance.map(a => [a.student_id, a.name, a.date, a.time]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `attendance_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 font-medium">Loading VisionAttend...</p>
        </div>
      </div>
    );
  }

  if (view === 'login') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500 mb-4">
              <Camera size={32} />
            </div>
            <h1 className="text-2xl font-bold text-white">VisionAttend</h1>
            <p className="text-zinc-400 text-sm">Admin Portal Login</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Username</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                placeholder="admin"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                placeholder="••••••••"
              />
            </div>
            {authError && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                <AlertCircle size={16} />
                <span>{authError}</span>
              </div>
            )}
            <button 
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-lg shadow-emerald-500/20"
            >
              Sign In
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-800 bg-zinc-900/50 flex flex-col p-4">
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white">
            <Camera size={18} />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">VisionAttend</span>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem 
            icon={LayoutDashboard} 
            label="Dashboard" 
            active={view === 'dashboard'} 
            onClick={() => setView('dashboard')} 
          />
          <SidebarItem 
            icon={Camera} 
            label="Attendance" 
            active={view === 'attendance'} 
            onClick={() => setView('attendance')} 
          />
          <SidebarItem 
            icon={Users} 
            label="Students" 
            active={view === 'students'} 
            onClick={() => setView('students')} 
          />
          <SidebarItem 
            icon={History} 
            label="History" 
            active={view === 'history'} 
            onClick={() => setView('history')} 
          />
        </nav>

        <button 
          onClick={() => setView('login')}
          className="flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-red-400 transition-colors mt-auto"
        >
          <LogOut size={20} />
          <span className="font-medium">Logout</span>
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-16 border-bottom border-zinc-800 flex items-center justify-between px-8 bg-zinc-900/30 backdrop-blur-sm sticky top-0 z-10">
          <h2 className="text-lg font-semibold text-white capitalize">{view}</h2>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-white">{user?.username}</p>
              <p className="text-xs text-zinc-500">Administrator</p>
            </div>
            <div className="w-10 h-10 bg-zinc-800 rounded-full border border-zinc-700 flex items-center justify-center">
              <Users size={20} className="text-zinc-400" />
            </div>
          </div>
        </header>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {view === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-emerald-500/10 text-emerald-500 rounded-xl">
                        <Users size={24} />
                      </div>
                      <span className="text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full">Total</span>
                    </div>
                    <h3 className="text-3xl font-bold text-white">{students.length}</h3>
                    <p className="text-zinc-500 text-sm mt-1">Registered Students</p>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl">
                        <CheckCircle2 size={24} />
                      </div>
                      <span className="text-xs font-medium text-blue-500 bg-blue-500/10 px-2 py-1 rounded-full">Today</span>
                    </div>
                    <h3 className="text-3xl font-bold text-white">
                      {attendance.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length}
                    </h3>
                    <p className="text-zinc-500 text-sm mt-1">Attendance Marked</p>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-amber-500/10 text-amber-500 rounded-xl">
                        <AlertCircle size={24} />
                      </div>
                      <span className="text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full">Pending</span>
                    </div>
                    <h3 className="text-3xl font-bold text-white">
                      {Math.max(0, students.length - attendance.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length)}
                    </h3>
                    <p className="text-zinc-500 text-sm mt-1">Absent Students</p>
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                    <h3 className="font-semibold text-white">Recent Activity</h3>
                    <button onClick={() => setView('history')} className="text-sm text-emerald-400 hover:underline">View All</button>
                  </div>
                  <div className="divide-y divide-zinc-800 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {attendance.map((record) => (
                      <div key={record.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400">
                            {record.name[0]}
                          </div>
                          <div>
                            <p className="font-medium text-white">{record.name}</p>
                            <p className="text-xs text-zinc-500">ID: {record.student_id}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-zinc-300">{record.time}</p>
                          <p className="text-xs text-zinc-500">{record.date}</p>
                        </div>
                      </div>
                    ))}
                    {attendance.length === 0 && (
                      <div className="p-12 text-center text-zinc-500">No activity recorded yet.</div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'attendance' && (
              <motion.div 
                key="attendance"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-4xl mx-auto"
              >
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                  <div className="relative aspect-video bg-black">
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      muted 
                      className="w-full h-full object-cover"
                    />
                    <canvas 
                      ref={canvasRef} 
                      className="absolute top-0 left-0 w-full h-full"
                    />
                    {!modelsLoaded && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                          <p className="text-sm text-zinc-400">Loading AI Models...</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-6 bg-zinc-900 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-3 h-3 rounded-full animate-pulse",
                        isScanning ? "bg-emerald-500" : "bg-red-500"
                      )} />
                      <div>
                        <p className="text-sm font-medium text-white">System Status</p>
                        <p className="text-xs text-zinc-500">{scanStatus}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setIsScanning(!isScanning)}
                        className={cn(
                          "px-4 py-2 rounded-lg font-medium transition-all",
                          isScanning 
                            ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" 
                            : "bg-emerald-500 text-white hover:bg-emerald-600"
                        )}
                      >
                        {isScanning ? "Pause Scanner" : "Start Scanner"}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                    <h4 className="font-semibold text-white mb-4">How it works</h4>
                    <ul className="space-y-3 text-sm text-zinc-400">
                      <li className="flex gap-3">
                        <span className="w-5 h-5 bg-zinc-800 rounded flex items-center justify-center text-xs text-emerald-400">1</span>
                        Position your face clearly within the camera frame.
                      </li>
                      <li className="flex gap-3">
                        <span className="w-5 h-5 bg-zinc-800 rounded flex items-center justify-center text-xs text-emerald-400">2</span>
                        The AI will detect and match your face with the database.
                      </li>
                      <li className="flex gap-3">
                        <span className="w-5 h-5 bg-zinc-800 rounded flex items-center justify-center text-xs text-emerald-400">3</span>
                        Once recognized, attendance is marked automatically for today.
                      </li>
                    </ul>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                    <h4 className="font-semibold text-white mb-4">Recent Scans (Today)</h4>
                    <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                      {attendance
                        .filter(a => a.date === format(new Date(), 'yyyy-MM-dd'))
                        .map(a => (
                          <div key={a.id} className="flex items-center justify-between text-sm py-2 border-b border-zinc-800 last:border-0">
                            <div className="flex items-center gap-3">
                              <div className="w-6 h-6 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center text-[10px] font-bold">
                                {a.name[0]}
                              </div>
                              <span className="text-zinc-300 font-medium">{a.name}</span>
                            </div>
                            <span className="text-zinc-500 text-xs">{a.time}</span>
                          </div>
                        ))}
                      {attendance.filter(a => a.date === format(new Date(), 'yyyy-MM-dd')).length === 0 && (
                        <div className="text-center py-4 text-zinc-500 text-xs">No scans yet today.</div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'students' && (
              <motion.div 
                key="students"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Registration Form */}
                  <div className="lg:col-span-1 space-y-6">
                    <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                      <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                        <UserPlus size={20} className="text-emerald-500" />
                        Register Student
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Full Name</label>
                          <input 
                            type="text" 
                            value={newStudent.name}
                            onChange={(e) => setNewStudent({...newStudent, name: e.target.value})}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            placeholder="John Doe"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Student ID</label>
                          <input 
                            type="text" 
                            value={newStudent.id}
                            onChange={(e) => setNewStudent({...newStudent, id: e.target.value})}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                            placeholder="STU001"
                          />
                        </div>
                        <div className="aspect-video bg-black rounded-lg overflow-hidden relative border border-zinc-800">
                          <video ref={videoRef} autoPlay muted className="w-full h-full object-cover" />
                          <canvas ref={regCanvasRef} className="absolute top-0 left-0 w-full h-full" />
                          <div className={cn(
                            "absolute inset-0 border-2 pointer-events-none transition-colors duration-300",
                            regFaceDetected ? "border-emerald-500/50" : "border-red-500/30"
                          )} />
                          {!regFaceDetected && (
                            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-red-500/80 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                              No Face Detected
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={handleAddStudent}
                          disabled={capturing || !newStudent.name || !newStudent.id || !regFaceDetected}
                          className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
                        >
                          {capturing ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <Camera size={18} />
                              Capture & Register
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Student List */}
                  <div className="lg:col-span-2">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                        <h3 className="font-semibold text-white">Registered Students</h3>
                        <div className="relative">
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                          <input 
                            type="text" 
                            placeholder="Search students..."
                            className="bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          />
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-zinc-800/50 text-xs uppercase tracking-wider text-zinc-500">
                            <tr>
                              <th className="px-6 py-4 font-semibold">Student</th>
                              <th className="px-6 py-4 font-semibold">ID</th>
                              <th className="px-6 py-4 font-semibold">Status</th>
                              <th className="px-6 py-4 font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800">
                            {students.map((student) => (
                              <tr key={student.id} className="hover:bg-zinc-800/30 transition-colors">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-xs text-zinc-400">
                                      {student.name[0]}
                                    </div>
                                    <span className="font-medium text-white">{student.name}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-sm text-zinc-400">{student.student_id}</td>
                                <td className="px-6 py-4">
                                  <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full border border-emerald-400/20">Active</span>
                                </td>
                                <td className="px-6 py-4">
                                  <button className="text-zinc-500 hover:text-white transition-colors">Edit</button>
                                </td>
                              </tr>
                            ))}
                            {students.length === 0 && (
                              <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-zinc-500">No students registered.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {view === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <CalendarIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input 
                        type="date" 
                        className="bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      />
                    </div>
                    <button className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                      Filter
                    </button>
                  </div>
                  <button 
                    onClick={downloadCSV}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-500/20"
                  >
                    <Download size={16} />
                    Export CSV
                  </button>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-zinc-800/50 text-xs uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="px-6 py-4 font-semibold">Student Name</th>
                          <th className="px-6 py-4 font-semibold">Student ID</th>
                          <th className="px-6 py-4 font-semibold">Date</th>
                          <th className="px-6 py-4 font-semibold">Time</th>
                          <th className="px-6 py-4 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {attendance.map((record) => (
                          <tr key={record.id} className="hover:bg-zinc-800/30 transition-colors">
                            <td className="px-6 py-4 font-medium text-white">{record.name}</td>
                            <td className="px-6 py-4 text-sm text-zinc-400">{record.student_id}</td>
                            <td className="px-6 py-4 text-sm text-zinc-400">{record.date}</td>
                            <td className="px-6 py-4 text-sm text-zinc-400">{record.time}</td>
                            <td className="px-6 py-4">
                              <span className="text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full">Present</span>
                            </td>
                          </tr>
                        ))}
                        {attendance.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">No attendance records found.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
