const { poolPromise, sql } = require('../db');
const { uploadBuffer, containerName } = require('../blob');
const QRCode = require('qrcode');
const { BlobServiceClient } = require('@azure/storage-blob');

exports.getAll = async (req, res) => {
  try {
    const pool = await poolPromise;
    
    const result = await pool.request()
      .query(`SELECT v.VisitorID, v.Name, v.ContactNumber, v.Address, v.Purpose, 
                     v.CheckInTime, v.CheckOutTime, v.IDProof, v.QRCode,
                     p.PatientID, p.Name as PatientName, p.Ward, p.AllowedVisitHours
              FROM Visitors v
              LEFT JOIN Patients p ON v.PatientID = p.PatientID
              ORDER BY v.VisitorID DESC`);

    const accountName = process.env.STORAGE_CONNECTION.split(';').find(s => s.startsWith('AccountName=')).split('=')[1];

    const visitors = result.recordset.map(v => ({
      ...v,
      IDProofUrl: v.IDProof ? `https://${accountName}.blob.core.windows.net/${containerName}/${v.IDProof}` : null
    }));

    res.json(visitors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.register = async (req, res) => {
  try {
    const { name, contact, address, purpose, patient } = req.body;
    const file = req.file;

    if (!name || !contact) return res.status(400).json({ error: 'Name and contact required' });

    const pool = await poolPromise;
    
    // Set current time for check-in
    const currentTime = new Date();

    // Get patient info if patient is selected
    let patientInfo = null;
    if (patient) {
      const patientResult = await pool.request()
        .input('PatientID', sql.Int, patient)
        .query('SELECT Name, Ward FROM Patients WHERE PatientID = @PatientID');
      
      if (patientResult.recordset.length > 0) {
        patientInfo = patientResult.recordset[0];
      }
    }

    const insertResult = await pool.request()
      .input('Name', sql.NVarChar(100), name)
      .input('ContactNumber', sql.NVarChar(50), contact)
      .input('Address', sql.NVarChar(255), address || null)
      .input('IDProof', sql.NVarChar(255), null)
      .input('Purpose', sql.NVarChar(200), purpose || null)
      .input('PatientID', sql.Int, patient ? parseInt(patient) : null)
      .input('CheckInTime', sql.DateTime, currentTime)
      .query(`INSERT INTO Visitors (Name, ContactNumber, Address, IDProof, Purpose, PatientID, CheckInTime)
              OUTPUT INSERTED.VisitorID AS id
              VALUES (@Name, @ContactNumber, @Address, @IDProof, @Purpose, @PatientID, @CheckInTime)`);

    const insertedId = insertResult.recordset[0].id;

    let blobUrl = null;
    if (file) {
      const blobName = `visitor-${insertedId}-${Date.now()}-${file.originalname.replace(/\s+/g,'_')}`;
      blobUrl = await uploadBuffer(containerName, blobName, file.buffer, file.mimetype);
      await pool.request()
        .input('IDProof', sql.NVarChar(255), blobName)
        .input('VisitorID', sql.Int, insertedId)
        .query('UPDATE Visitors SET IDProof = @IDProof WHERE VisitorID = @VisitorID');
    }

    // Generate QR
    const qrPayload = `HVMS:visitor:${insertedId}`;
    const qrImage = await QRCode.toDataURL(qrPayload);

    await pool.request()
      .input('QRCode', sql.NVarChar(sql.MAX), qrImage)
      .input('VisitorID', sql.Int, insertedId)
      .query('UPDATE Visitors SET QRCode = @QRCode WHERE VisitorID = @VisitorID');

    res.status(201).json({
      success: true,
      visitor: {
        VisitorID: insertedId,
        Name: name,
        ContactNumber: contact,
        CheckInTime: currentTime,
        CheckOutTime: null,
        IDProofUrl: blobUrl,
        QRCode: qrImage,
        PatientName: patientInfo ? patientInfo.Name : null,
        Ward: patientInfo ? patientInfo.Ward : null
      }
    });

  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: err.message });
  }
};

// Add new function for check-out
exports.checkOut = async (req, res) => {
  try {
    const { visitorId } = req.params;
    const currentTime = new Date();

    const pool = await poolPromise;
    
    await pool.request()
      .input('CheckOutTime', sql.DateTime, currentTime)
      .input('VisitorID', sql.Int, visitorId)
      .query('UPDATE Visitors SET CheckOutTime = @CheckOutTime WHERE VisitorID = @VisitorID');

    res.json({ 
      success: true, 
      message: 'Visitor checked out successfully',
      checkOutTime: currentTime
    });
  } catch (err) {
    console.error('checkOut error', err);
    res.status(500).json({ error: err.message });
  }
};

// Updated downloadIDProof function to properly stream the file
exports.downloadIDProof = async (req, res) => {
    try {
        const { visitorId } = req.params;
        
        const pool = await poolPromise;
        const result = await pool.request()
            .input('VisitorID', sql.Int, visitorId)
            .query('SELECT IDProof FROM Visitors WHERE VisitorID = @VisitorID');
        
        if (result.recordset.length === 0 || !result.recordset[0].IDProof) {
            return res.status(404).json({ error: 'ID proof not found' });
        }
        
        const blobName = result.recordset[0].IDProof;
        
        // Initialize BlobServiceClient
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION);
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blobClient = containerClient.getBlobClient(blobName);
        
        // Check if blob exists
        const exists = await blobClient.exists();
        if (!exists) {
            return res.status(404).json({ error: 'ID proof file not found in storage' });
        }
        
        // Get blob properties to determine content type
        const properties = await blobClient.getProperties();
        
        // Set headers for file download
        res.setHeader('Content-Disposition', `attachment; filename="${blobName}"`);
        res.setHeader('Content-Type', properties.contentType);
        
        // Stream the blob to the response
        const downloadResponse = await blobClient.download();
        downloadResponse.readableStreamBody.pipe(res);
        
    } catch (err) {
        console.error('Download ID proof error:', err);
        res.status(500).json({ error: err.message });
    }
};

// Add this function to generate a SAS URL
function generateSasUrl(blobName) {
    const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');
    
    const accountName = process.env.STORAGE_CONNECTION.split(';').find(s => s.startsWith('AccountName=')).split('=')[1];
    const accountKey = process.env.STORAGE_CONNECTION.split(';').find(s => s.startsWith('AccountKey=')).split('=')[1];
    
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    
    const permissions = new BlobSASPermissions();
    permissions.read = true;
    
    const startsOn = new Date();
    const expiresOn = new Date(startsOn);
    expiresOn.setMinutes(startsOn.getMinutes() + 5); // SAS valid for 5 minutes
    
    const sasOptions = {
        containerName,
        blobName,
        permissions: permissions.toString(),
        startsOn,
        expiresOn
    };
    
    const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
    
    return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}

// Modified downloadIDProof function using SAS URL
exports.downloadIDProof = async (req, res) => {
    try {
        const { visitorId } = req.params;
        console.log(`Download request for visitor ID: ${visitorId}`);
        
        const pool = await poolPromise;
        const result = await pool.request()
            .input('VisitorID', sql.Int, visitorId)
            .query('SELECT IDProof FROM Visitors WHERE VisitorID = @VisitorID');
        
        if (result.recordset.length === 0) {
            console.log('Visitor not found');
            return res.status(404).json({ error: 'Visitor not found' });
        }
        
        const blobName = result.recordset[0].IDProof;
        
        if (!blobName) {
            console.log('ID proof not found for visitor');
            return res.status(404).json({ error: 'ID proof not found for this visitor' });
        }
        
        console.log(`Blob name: ${blobName}`);
        
        // Generate SAS URL for direct download
        const sasUrl = generateSasUrl(blobName);
        console.log(`Redirecting to SAS URL: ${sasUrl}`);
        
        // Redirect to the SAS URL for direct download
        res.redirect(sasUrl);
        
    } catch (err) {
        console.error('Download ID proof error:', err);
        res.status(500).json({ error: err.message });
    }
};