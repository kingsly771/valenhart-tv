const mongoose = require('mongoose');

const playlistSchema = new mongoose.Schema({
  name: {
    type:     String,
    required: true,
    trim:     true,
  },
  url: {
    type:    String,
    default: null,
  },
  channelCount: {
    type:    Number,
    default: 0,
  },
  categories: [{
    name:  String,
    count: Number,
  }],
  isActive: {
    type:    Boolean,
    default: false,
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
  },
}, { timestamps: true });

module.exports = mongoose.model('Playlist', playlistSchema);
