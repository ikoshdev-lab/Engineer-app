const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const multer = require('multer'); // Fayl yuklash uchun
const fs = require('fs');
const os = require('os');

// Ilovani sozlash
const app = express();
const server = http.createServer(app); // Socket.io uchun http server kerak

// Socket.io sozlamalari (Real vaqt rejimi uchun)
const io = new Server(server, {
  cors: {
    origin: "*", // Hamma joydan ulanishga ruxsat berish
    methods: ["GET", "POST"]
  }
});

// Middleware (O'rtakash dasturlar)
app.use(cors()); // Boshqa domenlardan kirishga ruxsat
app.use(express.json()); // JSON ma'lumotlarni o'qish
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Yuklangan fayllarni ochish

// Uploads papkasini yaratish (agar yo'q bo'lsa)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer sozlamalari (Fayl yuklash)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Unikal nom berish
    }
});
const upload = multer({ storage: storage });

// MongoDB ga ulanish (Kompyuteringizdagi lokal baza)
const mongoUrl = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/engineer-app';

mongoose.connect(mongoUrl)
  .then(() => console.log('MongoDB bazasiga muvaffaqiyatli ulandi!'))
  .catch(err => console.error('MongoDB xatosi:', err));

// --- MONGODB SCHEMAS (Jadvallar) ---

// Foydalanuvchi Jadvali
const UserSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    headline: String,
    phone: String,
    githubUsername: String,
    avatar: String,
    coverPhoto: String,
    about: String,
    skills: Array,
    experience: Array,
    education: Array,
    portfolio: Array,
    isPremium: { type: Boolean, default: false },
    isMentor: { type: Boolean, default: false },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    isBlocked: { type: Boolean, default: false },
    achievements: Array,
    joinedDate: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Post Jadvali
const PostSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: String,
    image: String,
    video: String,
    likes: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    commentsList: Array,
    type: { type: String, default: 'text' }, // text, poll, event
    pollOptions: Array,
    totalVotes: { type: Number, default: 0 },
    eventTitle: String,
    eventDate: String,
    eventLocation: String,
    code: String,
    file: Object,
    location: String,
    tags: Array,
    timestamp: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

// Xabarlar Jadvali (Chat)
const MessageSchema = new mongoose.Schema({
    from: String,
    to: String,
    senderName: String,
    text: String,
    image: String,
    videoNote: String,
    audio: String,
    file: Object,
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});
const Message = mongoose.model('Message', MessageSchema);

// Story Jadvali (24 soatdan keyin o'chadi)
const StorySchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    image: String,
    video: String,
    type: { type: String, default: 'image' },
    timestamp: { type: Date, default: Date.now, expires: 86400 } // 86400 sekund = 24 soat
});
const Story = mongoose.model('Story', StorySchema);

// --- API ROUTES (Backend funksiyalari) ---

// 1. Ro'yxatdan o'tish
app.post('/api/register', async (req, res) => {
    try {
        const { email } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ success: false, message: "Bu email band." });
        
        const newUser = new User(req.body);
        await newUser.save();
        res.json({ success: true, user: newUser });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. Kirish (Login)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email, password });
        if (user) res.json({ success: true, user });
        else res.status(401).json({ success: false, message: "Email yoki parol xato" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. Fayl yuklash
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (req.file) {
        res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname, type: req.file.mimetype });
    } else {
        res.status(400).json({ error: 'Fayl yuklanmadi' });
    }
});

// 4. Foydalanuvchilarni olish
app.get('/api/users', async (req, res) => {
    const users = await User.find();
    res.json(users.map(u => ({ 
        ...u._doc, 
        id: u._id, 
        userId: u.email,
        followersCount: u.followers.length,
        followingCount: u.following.length
    })));
});

// 5. Post yaratish
app.post('/api/posts', async (req, res) => {
    const { author, ...postData } = req.body;
    const user = await User.findOne({ email: author.userId });
    if (user) {
        const newPost = new Post({ ...postData, author: user._id });
        await newPost.save();
        res.json(newPost);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// 6. Postlarni olish
app.get('/api/posts', async (req, res) => {
    const posts = await Post.find().sort({ timestamp: -1 }).populate('author');
    const formattedPosts = posts.map(p => {
        if(!p.author) return null;
        return {
            ...p._doc,
            id: p._id,
            time: new Date(p.timestamp).toLocaleString(),
            author: {
                name: p.author.name,
                headline: p.author.headline,
                avatar: p.author.avatar,
                userId: p.author.email,
                isVerified: p.author.isPremium
            }
        };
    }).filter(p => p !== null);
    res.json(formattedPosts);
});

// 7. Admin: Foydalanuvchini bloklash
app.post('/api/admin/block', async (req, res) => {
    try {
        const { userId, isBlocked } = req.body;
        await User.updateOne({ email: userId }, { isBlocked });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Admin: Foydalanuvchini o'chirish
app.delete('/api/admin/delete/:id', async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. Chat tarixini olish
app.get('/api/messages/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const messages = await Message.find({
            $or: [{ from: user1, to: user2 }, { from: user2, to: user1 }]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 10. Foydalanuvchi ma'lumotlarini yangilash (Profilni saqlash)
app.put('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const user = await User.findByIdAndUpdate(id, updates, { new: true });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 11. Story yaratish
app.post('/api/stories', async (req, res) => {
    try {
        const { authorId, image, video, type } = req.body;
        const newStory = new Story({ author: authorId, image, video, type });
        await newStory.save();
        res.json(newStory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 12. Storylarni olish
app.get('/api/stories', async (req, res) => {
    try {
        const stories = await Story.find().populate('author').sort({ timestamp: -1 });
        res.json(stories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 13. Obuna bo'lish (Follow/Unfollow)
app.post('/api/users/follow', async (req, res) => {
    try {
        const { currentUserId, targetUserId } = req.body;
        
        const currentUser = await User.findById(currentUserId);
        const targetUser = await User.findById(targetUserId);

        if (!currentUser || !targetUser) return res.status(404).json({ error: 'User not found' });

        // Tekshirish: allaqachon obuna bo'lganmi?
        const isFollowing = currentUser.following.includes(targetUserId);

        if (isFollowing) {
            currentUser.following.pull(targetUserId);
            targetUser.followers.pull(currentUserId);
        } else {
            currentUser.following.push(targetUserId);
            targetUser.followers.push(currentUserId);
        }

        await currentUser.save();
        await targetUser.save();

        res.json({ success: true, isFollowing: !isFollowing });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Asosiy sahifa (index.html ni yuborish)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// SEO fayllari (robots.txt va sitemap.xml)
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.sendFile(path.join(__dirname, 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

// Socket.io ulanishini tinglash
io.on('connection', (socket) => {
  console.log('Yangi foydalanuvchi ulandi ID:', socket.id);

  // Chat xabarlari va boshqa real-vaqt hodisalari shu yerda qoladi
  socket.on('join', (userId) => {
      socket.join(userId);
  });

  // Xabar yuborish va bazaga saqlash
  socket.on('private_message', async (data) => {
      try {
          const newMessage = new Message(data);
          await newMessage.save();
          io.to(data.to).emit('new_message', data);
      } catch (err) {
          console.error('Xabarni saqlashda xatolik:', err);
      }
  });

  socket.on('disconnect', () => {
    console.log('Foydalanuvchi chiqib ketdi');
  });
});

// Serverni ishga tushirish
const PORT = process.env.PORT || 5001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server http://localhost:${PORT} manzilida ishga tushdi`);

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`Boshqa qurilmalardan (Wi-Fi) kirish uchun: http://${iface.address}:${PORT}`);
      }
    }
  }
});