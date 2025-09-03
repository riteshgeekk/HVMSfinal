const express = require('express');
const path = require('path');
const visitorsRoute = require('./routes/visitors');
const patientsRoute = require('./routes/patients'); // Add this line
require('dotenv').config();

const app = express();
const cors = require('cors');

// Allow all origins (for development)
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/visitors', visitorsRoute);
app.use('/api/patients', patientsRoute); // Add this line

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server running on port ${port}`));