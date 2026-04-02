const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  _id: String,
  data: Object,
  revisions: [
    {
      data: Object,
      savedAt: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model('Document', documentSchema);