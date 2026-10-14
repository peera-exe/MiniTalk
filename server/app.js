require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URL = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DATABASE_NAME = 'forum-db';
const AVATAR_COUNT = 12; // ต้องตรงกับจำนวนอวาตาร์ใน public/script.js

app.use(cors());
app.use(express.json());

// เสิร์ฟไฟล์ Static จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, '../public')));

let db, usersCollection, postsCollection;

// เมื่อเรียกหน้าเว็บ root (http://localhost:5000/) ให้ส่งไฟล์ index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ==================== HELPERS ====================

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function publicUser(u) {
  return {
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    bio: u.bio || '',
    avatar: Number.isInteger(u.avatar) ? u.avatar : undefined
  };
}

// รวบรวมข้อมูลผู้เขียนโพสต์/คอมเมนต์ เพื่อให้ client แสดงชื่อและอวาตาร์ได้
async function usersMapFor(posts) {
  const names = new Set();
  posts.forEach(p => {
    names.add(p.author);
    (p.comments || []).forEach(c => names.add(c.author));
  });
  const list = await usersCollection
    .find({ username: { $in: [...names] } })
    .project({ username: 1, name: 1, avatar: 1 })
    .toArray();
  const map = {};
  list.forEach(u => { map[u.username] = { username: u.username, name: u.name, avatar: u.avatar }; });
  return map;
}

async function postPayload(id) {
  const post = await postsCollection.findOne({ _id: new ObjectId(id) });
  if (!post) return null;
  return { post, users: await usersMapFor([post]) };
}

// ==================== AUTH ENDPOINTS ====================

// Register
app.post('/api/register', async (req, res) => {
  const { username, name, email, password } = req.body;
  if (!username || !name || !email || !password) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      username: username.trim(),
      name,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'member',
      bio: '',
      avatar: Math.floor(Math.random() * AVATAR_COUNT),
      createdAt: new Date()
    };

    const result = await usersCollection.insertOne(newUser);
    res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ', userId: result.insertedId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Username หรือ Email นี้ถูกใช้งานแล้ว' });
    }
    res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก Username และ Password' });
  }

  const user = await usersCollection.findOne({ username });
  const isMatch = user && await bcrypt.compare(password, user.passwordHash);

  if (!isMatch) {
    return res.status(401).json({ error: 'Username หรือ รหัสผ่านไม่ถูกต้อง' });
  }

  res.json({ message: 'เข้าสู่ระบบสำเร็จ', user: publicUser(user) });
});

// Forgot Password
app.post('/api/forgot-password', async (req, res) => {
  const { username, email, newPassword } = req.body;
  if (!username || !email || !newPassword) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
  }

  const user = await usersCollection.findOne({ username, email: email.toLowerCase().trim() });
  if (!user) {
    return res.status(404).json({ error: 'ไม่พบบัญชีผู้ใช้ที่มี Username และ Email นี้' });
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 10);
  await usersCollection.updateOne(
    { _id: user._id },
    { $set: { passwordHash: newPasswordHash } }
  );

  res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ สามารถเข้าสู่ระบบได้ทันที' });
});

// ==================== USER / PROFILE ENDPOINTS ====================

// ดูโปรไฟล์ (ไม่ส่งอีเมลออกไป)
app.get('/api/users/:username', async (req, res) => {
  try {
    const user = await usersCollection.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
    const postCount = await postsCollection.countDocuments({ author: user.username });
    res.json({
      username: user.username,
      name: user.name,
      bio: user.bio || '',
      avatar: Number.isInteger(user.avatar) ? user.avatar : undefined,
      role: user.role,
      createdAt: user.createdAt,
      postCount
    });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลโปรไฟล์ได้' });
  }
});

// แก้ไขโปรไฟล์ (แก้ได้เฉพาะของตัวเอง)
app.put('/api/users/:username', async (req, res) => {
  const { requestUser, name, bio, avatar } = req.body;
  if (!requestUser || requestUser !== req.params.username) {
    return res.status(403).json({ error: 'คุณแก้ไขได้เฉพาะโปรไฟล์ของตัวเอง' });
  }
  if (!name || !name.trim() || name.length > 60) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อที่แสดง (ไม่เกิน 60 ตัวอักษร)' });
  }
  if ((bio || '').length > 160) {
    return res.status(400).json({ error: 'Bio ยาวได้ไม่เกิน 160 ตัวอักษร' });
  }
  if (!Number.isInteger(avatar) || avatar < 0 || avatar >= AVATAR_COUNT) {
    return res.status(400).json({ error: 'อวาตาร์ที่เลือกไม่ถูกต้อง' });
  }

  try {
    const result = await usersCollection.findOneAndUpdate(
      { username: req.params.username },
      { $set: { name: name.trim(), bio: (bio || '').trim(), avatar } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
    res.json({ message: 'บันทึกโปรไฟล์แล้ว', user: publicUser(result) });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถบันทึกโปรไฟล์ได้' });
  }
});

// ==================== POSTS ENDPOINTS ====================

// Get Posts  (?q=ค้นหา &category=หมวด &tag=แท็ก &author=ผู้เขียน)
app.get('/api/posts', async (req, res) => {
  try {
    const { q, category, tag, author } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (tag) filter.tags = tag;
    if (author) filter.author = author;
    if (q && q.trim()) {
      const rx = new RegExp(escapeRegex(q.trim()), 'i');
      filter.$or = [{ title: rx }, { content: rx }, { tags: rx }, { author: rx }];
    }
    const posts = await postsCollection.find(filter).sort({ createdAt: -1 }).toArray();
    res.json({ posts, users: await usersMapFor(posts) });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลโพสต์ได้' });
  }
});

// หมวดหมู่ + แท็กยอดนิยม สำหรับแถบด้านขวา
app.get('/api/trending', async (req, res) => {
  try {
    const categories = await postsCollection.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]).toArray();
    const tags = await postsCollection.aggregate([
      { $unwind: '$tags' },
      { $match: { tags: { $ne: '' } } },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 8 }
    ]).toArray();
    res.json({ categories, tags });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลได้' });
  }
});

// Create Post
app.post('/api/posts', async (req, res) => {
  const { title, content, author, category, tags } = req.body;
  if (!title || !content || !author) {
    return res.status(400).json({ error: 'กรุณากรอก Title, Content และ Author' });
  }

  const tagList = (Array.isArray(tags) ? tags : (tags ? tags.split(',') : []))
    .map(t => String(t).trim().replace(/^#/, ''))
    .filter(Boolean);

  const newPost = {
    title,
    content,
    author,
    category: category || 'ทั่วไป',
    tags: tagList,
    likes: [],
    comments: [],
    createdAt: new Date()
  };

  try {
    const result = await postsCollection.insertOne(newPost);
    res.status(201).json({ message: 'สร้างโพสต์สำเร็จ', postId: result.insertedId, ...newPost });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถสร้างโพสต์ได้' });
  }
});

// Delete Post
app.delete('/api/posts/:id', async (req, res) => {
  const { id } = req.params;
  const { requestUser, role } = req.body;

  try {
    const post = await postsCollection.findOne({ _id: new ObjectId(id) });
    if (!post) {
      return res.status(404).json({ error: 'ไม่พบโพสต์ที่ต้องการลบ' });
    }

    if (post.author !== requestUser && role !== 'admin') {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ลบโพสต์นี้' });
    }

    await postsCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: 'ลบโพสต์เรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถลบโพสต์ได้' });
  }
});

// Like / Unlike (กดซ้ำเพื่อยกเลิก)
app.post('/api/posts/:id/like', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'กรุณาเข้าสู่ระบบก่อนกดไลก์' });

  try {
    const _id = new ObjectId(req.params.id);
    const post = await postsCollection.findOne({ _id });
    if (!post) return res.status(404).json({ error: 'ไม่พบโพสต์นี้' });

    const liked = (post.likes || []).includes(username);
    await postsCollection.updateOne(
      { _id },
      liked ? { $pull: { likes: username } } : { $addToSet: { likes: username } }
    );
    res.json(await postPayload(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถกดไลก์ได้' });
  }
});

// Add Comment
app.post('/api/posts/:id/comments', async (req, res) => {
  const { author, content } = req.body;
  if (!author || !content || !content.trim()) {
    return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความคอมเมนต์' });
  }
  if (content.length > 500) {
    return res.status(400).json({ error: 'คอมเมนต์ยาวได้ไม่เกิน 500 ตัวอักษร' });
  }

  try {
    const _id = new ObjectId(req.params.id);
    const result = await postsCollection.updateOne(
      { _id },
      { $push: { comments: { _id: new ObjectId(), author, content: content.trim(), createdAt: new Date() } } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'ไม่พบโพสต์นี้' });
    res.status(201).json(await postPayload(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถคอมเมนต์ได้' });
  }
});

// Delete Comment (เจ้าของคอมเมนต์ / เจ้าของโพสต์ / Admin)
app.delete('/api/posts/:id/comments/:cid', async (req, res) => {
  const { requestUser, role } = req.body;

  try {
    const _id = new ObjectId(req.params.id);
    const cid = new ObjectId(req.params.cid);
    const post = await postsCollection.findOne({ _id });
    if (!post) return res.status(404).json({ error: 'ไม่พบโพสต์นี้' });

    const comment = (post.comments || []).find(c => c._id.equals(cid));
    if (!comment) return res.status(404).json({ error: 'ไม่พบคอมเมนต์นี้' });

    const allowed = requestUser === comment.author || requestUser === post.author || role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ลบคอมเมนต์นี้' });

    await postsCollection.updateOne({ _id }, { $pull: { comments: { _id: cid } } });
    res.json(await postPayload(req.params.id));
  } catch (err) {
    res.status(500).json({ error: 'ไม่สามารถลบคอมเมนต์ได้' });
  }
});

// Start Server
async function startServer() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DATABASE_NAME);
  usersCollection = db.collection('users');
  postsCollection = db.collection('posts');

  await usersCollection.createIndex({ username: 1 }, { unique: true });
  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await postsCollection.createIndex({ createdAt: -1 });

  console.log('Connected to MongoDB Successfully');
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Database connection failed:', err);
  process.exit(1);
});
