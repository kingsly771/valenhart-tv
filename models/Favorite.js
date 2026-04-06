const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  channelName: {
    type:     String,
    required: true,
  },
  streamUrl: {
    type:    String,
    default: '',
  },
  channelId: {
    type:    String,
    default: '',
  },
  logo: {
    type:    String,
    default: '',
  },
  group: {
    type:    String,
    default: '',
  },
}, { timestamps: { createdAt: 'addedAt', updatedAt: false } });

// Unique per user + channel
favoriteSchema.index({ userId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
