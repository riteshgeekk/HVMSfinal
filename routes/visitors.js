const express = require('express');
const router = express.Router();
const visitorController = require('../controllers/visitorController');
const multer = require('multer');
const upload = multer();

router.get('/', visitorController.getAll);
router.post('/', upload.single('idProof'), visitorController.register);
router.patch('/:visitorId/checkout', visitorController.checkOut);
router.get('/:visitorId/download-id', visitorController.downloadIDProof); 

module.exports = router;