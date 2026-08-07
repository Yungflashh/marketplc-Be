const express = require('express');
const router = express.Router();
const emailController = require('../controllers/email.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');

router.use(authenticate, isAdmin);

router.get('/', emailController.listCampaigns);
router.post('/', emailController.createCampaign);
router.post('/generate', emailController.generateDraft);
router.post('/preview-recipients', emailController.previewRecipients);
router.post('/preview-html', emailController.previewHtml);
router.post('/seed-defaults', emailController.seedDefaults);
router.get('/suggestions', emailController.suggestions);
router.post('/suggestions/act', emailController.actOnSuggestion);
router.get('/users/search', emailController.searchUsers);
router.get('/:id', emailController.getCampaign);
router.put('/:id', emailController.updateCampaign);
router.delete('/:id', emailController.deleteCampaign);
router.post('/:id/send', emailController.sendCampaign);

module.exports = router;
