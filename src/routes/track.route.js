const express = require('express');
const router = express.Router();
const trackController = require('../controllers/track.controller');

router.post('/visit', trackController.visit);

module.exports = router;
