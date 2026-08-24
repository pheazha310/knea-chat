require('dotenv').config();

const bcrypt = require('bcrypt');
const connection = require('../dist/src/database/connection');
const { pool } = connection.default || connection;

const email = 'admin@kneachat.com';
const password = 'kneachat168';

async function createDemoUser() {
  try {
    const [companyResult] = await pool.execute(
      `INSERT INTO companies (name, domain)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      ['KneaChat', 'kneachat.com']
    );
    const companyId = companyResult.insertId;

    const [existingDepartments] = await pool.execute(
      'SELECT id FROM departments WHERE company_id = ? AND name = ? LIMIT 1',
      [companyId, 'Administration']
    );
    let departmentId = existingDepartments[0]?.id;
    if (!departmentId) {
      const [departmentResult] = await pool.execute(
        'INSERT INTO departments (company_id, name, description) VALUES (?, ?, ?)',
        [companyId, 'Administration', 'KneaChat administrators']
      );
      departmentId = departmentResult.insertId;
    }
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.execute(
      `INSERT INTO users
        (company_id, department_id, first_name, last_name, email, password, role, job_title, status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', 1)
       ON DUPLICATE KEY UPDATE
         company_id = VALUES(company_id),
         department_id = VALUES(department_id),
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         password = VALUES(password),
         role = VALUES(role),
         job_title = VALUES(job_title),
         is_active = 1`,
      [companyId, departmentId, 'KneaChat', 'Admin', email, passwordHash, 'admin', 'System Administrator']
    );

    console.log(`Demo account is ready: ${email}`);
  } finally {
    await pool.end();
  }
}

createDemoUser().catch((error) => {
  console.error('Could not create the demo account:', error.message);
  process.exitCode = 1;
});
