require('dotenv').config();
const sql = require('mssql');

const poolPromise = new sql.ConnectionPool(process.env.DB_CONNECTION)
  .connect()
  .then(pool => {
    console.log('Connected to SQL Server');
    return pool;
  })
  .catch(err => console.log('DB Connection Failed', err));

module.exports = { sql, poolPromise };
