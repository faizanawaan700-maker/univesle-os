const fs = require('fs');

const filesToClean = [
    'src/app.module.ts',
    'src/products/products.controller.ts',
    'src/products/products.service.ts',
    'src/products/products.dto.ts'
];

filesToClean.forEach(filePath => {
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        let lines = content.split('\n');
        
        // Agar file bilkul adhi double ho gayi hai (exact duplicate halves)
        let mid = Math.floor(lines.length / 2);
        let firstHalf = lines.slice(0, mid).join('\n');
        let secondHalf = lines.slice(mid).join('\n');

        if (firstHalf.trim() === secondHalf.trim()) {
            fs.writeFileSync(filePath, firstHalf);
            console.log(`✅ Successfully cleaned exact duplicate in: ${filePath}`);
        } else {
            // Agar repetition kisi aur point par hai, to signature match karke clean karo
            let trimmed = content.trim();
            let halfLen = Math.floor(trimmed.length / 2);
            let firstPart = trimmed.substring(0, halfLen);
            
            // Check if the first part repeats right after
            let secondIdx = trimmed.indexOf(firstPart.substring(0, 100), 100);
            if (secondIdx !== -1 && secondIdx < trimmed.length - 50) {
                let cleaned = trimmed.substring(0, secondIdx).trim();
                fs.writeFileSync(filePath, cleaned);
                console.log(`✅ Successfully cleaned repeated block in: ${filePath}`);
            } else {
                console.log(`⚠️ Check manually: ${filePath}`);
            }
        }
    } else {
        console.log(`❌ File not found: ${filePath}`);
    }
});