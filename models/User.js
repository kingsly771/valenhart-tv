const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type:     String,
    required: true,
    unique:   true,
    trim:     true,
    minlength: 3,
    maxlength: 32,
  },
  email: {
    type:     String,
    required: true,
    unique:   true,
    lowercase: true,
    trim:     true,
  },
  password: {
    type:     String,
    required: true,
    minlength: 6,
  },
  role: {
    type:    String,
    enum:    ['admin', 'user'],
    default: 'user',
  },
  avatar: {
    type:    String,
    default: '🎭',
  },
  isActive: {
    type:    Boolean,
    default: true,
  },
  lastSeen: {
    type:    Date,
    default: Date.now,
  },
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
