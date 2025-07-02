const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://gerardify-vercel-frontend.vercel.app',
  process.env.FRONTEND_URL
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      /^https:\/\/.*\.vercel\.app$/.test(origin)
    ) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());

// MongoDB Connection
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://edebelen:erickdebelen1025@erickdebelen.0poxbsq.mongodb.net/gerardify?retryWrites=true&w=majority&appName=ErickDeBelen';
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Cloudinary Configuration
if (process.env.NODE_ENV === 'production') {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('Missing Cloudinary environment variables');
  }
}
cloudinary.config({
  cloud_name: 'dbapmmimu2',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create uploads directory if it doesn't exist 
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir) && process.env.NODE_ENV !== 'production') {
  fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'gerardify-songs',
    resource_type: 'auto',
    allowed_formats: ['mp3', 'wav', 'ogg', 'flac', 'm4a'],
    public_id: (req, file) => `song-${Date.now()}`, // ✅ Add unique public_id
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Song Schema
const songSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: { type: String, required: true },
  duration: { type: String, required: true },
  filePath: { type: String, required: true },
  publicId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const Song = mongoose.model('Song', songSchema);

// Playlist Schema
const playlistSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  artist: { type: String, required: true },
  year: { type: Number, default: () => new Date().getFullYear() },
  songs: [{
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'Song' },
    title: { type: String, required: true },
    artist: { type: String, required: true },
    duration: { type: String, required: true },
    filePath: { type: String, required: true }
  }],
  createdAt: { type: Date, default: Date.now }
});

const Playlist = mongoose.model('Playlist', playlistSchema);

// Checks if the database is connected
app.get('/api/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({ 
    status: 'OK', 
    environment: process.env.NODE_ENV || 'development',
    mongodb: mongoStatus,
    timestamp: new Date().toISOString()
  });
});

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.header('Access-Control-Allow-Credentials', true);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Gerardify Backend API',
    status: 'Running',
    endpoints: [
      'GET /api/health',
      'GET /api/songs', 
      'POST /api/songs',
      'GET /api/playlists',
      'POST /api/playlists',
      'GET /api/playlists/:id'
    ],
    timestamp: new Date().toISOString()
  });
});

// Routes
app.post('/api/songs', upload.single('file'), async (req, res) => {
  try {
    const { title, artist, duration } = req.body;

    if (req.file.size > 50 * 1024 * 1024) { // 50MB
      return res.status(413).json({ 
        message: 'File too large. Please use a file smaller than 50MB.' 
      });
    }

    const song = new Song({
      title,
      artist,
      duration,
      filePath: req.file.path,      
      publicId: req.file.filename     
    });

    await song.save();
    res.status(201).json(song);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// get song by ID
app.put('/api/songs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, artist } = req.body;

    const song = await Song.findByIdAndUpdate(
      id,
      { title, artist },
      { new: true }
    );

    if (!song) {
      return res.status(404).json({ message: 'Song not found' });
    }

    res.json(song);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete song by ID
app.delete('/api/songs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const song = await Song.findById(id);

    if (!song) {
      return res.status(404).json({ message: 'Song not found' });
    }

    // Delete from Cloudinary if in production
    if (process.env.NODE_ENV === 'production' && song.publicId) {
      try {
        await cloudinary.uploader.destroy(song.publicId, { resource_type: 'video' });
      } catch (cloudinaryError) {
        console.error('Error deleting from Cloudinary:', cloudinaryError);
      }
    }

    // Delete local file if in development
    if (process.env.NODE_ENV !== 'production' && !song.filePath.startsWith('data:')) {
      const filePath = path.join(__dirname, song.filePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete the song from the database
    await Song.findByIdAndDelete(id);
    res.json({ message: 'Song deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/songs', async (req, res) => {
  try {
    const songs = await Song.find().sort({ createdAt: -1 });
    res.json(songs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Playlist Routes
app.post('/api/playlists', async (req, res) => {
  try {
    const { name, artist } = req.body;
    console.log('Creating playlist with data:', { name, artist });
    
    const playlistId = Date.now();
    console.log('Generated playlist ID:', playlistId);
    
    const playlist = new Playlist({
      id: playlistId,
      name,
      artist,
      songs: []
    });
    
    console.log('New playlist object:', playlist);
    await playlist.save();
    console.log('Saved playlist:', playlist);
    
    res.status(201).json(playlist);
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/playlists', async (req, res) => {
  try {
    console.log('Fetching all playlists');
    const playlists = await Playlist.find().populate('songs');
    console.log('Found playlists:', playlists);
    res.json(playlists);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/playlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Fetching playlist with ID:', id);
    
    // Ensure id is parsed as a number
    const numericId = parseInt(id);
    if (isNaN(numericId)) {
      return res.status(400).json({ message: 'Invalid playlist ID format' });
    }

    const playlist = await Playlist.findOne({ id: numericId }).populate('songs');
    console.log('Found playlist:', playlist);
    
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    res.json(playlist);
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/playlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, artist } = req.body;

    const playlist = await Playlist.findOneAndUpdate(
      { id: parseInt(id) },
      { name, artist },
      { new: true }
    ).populate('songs');

    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    res.json(playlist);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/playlists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const playlist = await Playlist.findOneAndDelete({ id: parseInt(id) });
    
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add or update songs in a playlist
app.post('/api/playlists/:id/songs', async (req, res) => {
  try {
    const { id } = req.params;
    const { songId } = req.body;
    console.log('Adding song to playlist:', { playlistId: id, songId });

    const playlist = await Playlist.findOne({ id: parseInt(id) });
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    // Check if song exists
    const song = await Song.findById(songId);
    if (!song) {
      return res.status(404).json({ message: 'Song not found' });
    }

    // Check if song is already in playlist
    if (playlist.songs.some(s => s._id.toString() === songId)) {
      return res.status(400).json({ message: 'Song already in playlist' });
    }

    // Add song to playlist with full song data
    playlist.songs.push({
      _id: song._id,
      title: song.title,
      artist: song.artist,
      duration: song.duration,
      filePath: song.filePath
    });
    
    await playlist.save();

    // Get updated playlist
    const updatedPlaylist = await Playlist.findOne({ id: parseInt(id) });
    console.log('Updated playlist:', updatedPlaylist);
    
    res.json(updatedPlaylist);
  } catch (error) {
    console.error('Error adding song to playlist:', error);
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/playlists/:id/songs/:songId', async (req, res) => {
  try {
    const { id, songId } = req.params;

    const playlist = await Playlist.findOne({ id: parseInt(id) });
    if (!playlist) {
      return res.status(404).json({ message: 'Playlist not found' });
    }

    playlist.songs = playlist.songs.filter(song => song._id.toString() !== songId);
    await playlist.save();

    const updatedPlaylist = await Playlist.findOne({ id: parseInt(id) }).populate('songs');
    res.json(updatedPlaylist);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Debug route to list all playlists
app.get('/api/debug/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find().populate('songs');
    console.log('All playlists:', playlists);
    res.json(playlists);
  } catch (error) {
    console.error('Error fetching all playlists:', error);
    res.status(500).json({ message: error.message });
  }
});

// Serve uploaded files (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use('/uploads', express.static('uploads'));
}

// Export for Vercel
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}
