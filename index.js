require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 8080;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

// Configure Multer to use Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "uploads", 
    format: async (req, file) => {
      // Preserve original file extension
      return path.extname(file.originalname).slice(1) || 'png';
    },
    public_id: (req, file) => {
      // Generate unique identifier
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      return `${file.fieldname}-${uniqueSuffix}-${file.originalname}`;
    },
  },
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB file size limit
});

// Set EJS as the view engine
app.set("view engine", "ejs");
app.use(express.static('public'));
app.use(express.json());

// Shared folders tracking
const sharedFolders = new Map();

// Generate unique share link
function generateShareLink() {
  return crypto.randomBytes(16).toString('hex');
}

// Home route to display uploaded files
app.get("/", async (req, res) => {
  try {
    const resources = await cloudinary.api.resources({ 
      type: "upload", 
      prefix: "uploads/", 
      max_results: 500 
    });
    
    const files = resources.resources.map((file) => ({
      url: file.secure_url,
      filename: file.public_id,
      format: file.format,
      bytes: file.bytes,
      created_at: file.created_at
    })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.render("index", { 
      files, 
      theme: req.query.theme || 'light' 
    });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).render("error", { 
      message: "Error fetching files from Cloudinary.",
      theme: req.query.theme || 'light'
    });
  }
});

// Create shared folder route
app.post("/create-share", async (req, res) => {
  try {
    const shareLink = generateShareLink();
    const selectedFiles = req.body.files || [];
    
    sharedFolders.set(shareLink, {
      files: selectedFiles,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    res.json({ shareLink });
  } catch (error) {
    res.status(500).json({ error: "Could not create share link" });
  }
});

// Shared folder view route
app.get("/share/:linkId", async (req, res) => {
  const sharedFolder = sharedFolders.get(req.params.linkId);
  
  if (!sharedFolder || new Date() > sharedFolder.expiresAt) {
    return res.status(404).render("error", { 
      message: "Share link expired or invalid",
      theme: req.query.theme || 'light'
    });
  }

  try {
    const resources = await cloudinary.api.resources({ 
      type: "upload", 
      public_ids: sharedFolder.files 
    });
    
    const files = resources.resources.map((file) => ({
      url: file.secure_url,
      filename: file.public_id,
      format: file.format,
      bytes: file.bytes
    }));

    res.render("shared", { 
      files, 
      theme: req.query.theme || 'light' 
    });
  } catch (error) {
    res.status(500).render("error", { 
      message: "Error fetching shared files",
      theme: req.query.theme || 'light' 
    });
  }
});

// Upload file route with progress tracking
app.post("/upload", upload.single("file"), (req, res) => {
  if (req.file) {
    res.redirect("/?uploadSuccess=true");
  } else {
    res.redirect("/?uploadError=true");
  }
});

// Rename file route
app.post("/rename", async (req, res) => {
  const { oldFilename, newFilename } = req.body;
  
  try {
    // Cloudinary doesn't have a direct rename, so we'll use a workaround
    const resource = await cloudinary.api.resource(oldFilename);
    
    await cloudinary.uploader.rename(
      oldFilename, 
      `uploads/${newFilename}`, 
      { overwrite: true }
    );
    
    res.redirect("/?renameSuccess=true");
  } catch (error) {
    console.error("Rename error:", error);
    res.status(500).redirect("/?renameError=true");
  }
});

// Delete file route
app.get("/delete/:filename", async (req, res) => {
  try {
    await cloudinary.uploader.destroy(req.params.filename);
    res.redirect("/?deleteSuccess=true");
  } catch (error) {
    res.status(500).redirect("/?deleteError=true");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});