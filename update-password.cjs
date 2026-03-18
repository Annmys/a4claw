const bcrypt = require('bcrypt');

async function main() {
  const hash = await bcrypt.hash('Zz7758521', 12);
  console.log('Hash:', hash);
  
  // Output SQL
  console.log("\nRun this SQL:");
  console.log(`UPDATE web_credentials SET password_hash = '${hash.replace(/'/g, "''")}' WHERE username = 'Zz151620';`);
  
  // Verify
  const verify = await bcrypt.compare('Zz7758521', hash);
  console.log('\nVerify:', verify);
}

main();
