const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
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
  watchedAt: {
    type:    Date,
    default: Date.now,
  },
});

// Keep only last 200 per user
historySchema.index({ userId: 1, watchedAt: -1 });

module.exports = mongoose.model('History', historySchema);
