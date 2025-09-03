const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../db');

router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .query('SELECT PatientID, Name, Ward, AllowedVisitHours FROM Patients ORDER BY Name');
    
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;