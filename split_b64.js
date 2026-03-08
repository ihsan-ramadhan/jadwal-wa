const fs = require('fs');
const b64 = fs.readFileSync('auth_base64.txt', 'utf8').trim();

const CHUNK_SIZE = 45000;
let chunks = [];

for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
  chunks.push(b64.substring(i, i + CHUNK_SIZE));
}

chunks.forEach((chunk, index) => {
  fs.writeFileSync(`auth_secret_${index + 1}.txt`, chunk);
  console.log(`Berhasil membuat auth_secret_${index + 1}.txt (Panjang: ${chunk.length} karakter)`);
});

console.log(`\nSilakan buat ${chunks.length} rahasia di GitHub:`);
chunks.forEach((_, i) => console.log(`- WA_AUTH_${i + 1}`));
