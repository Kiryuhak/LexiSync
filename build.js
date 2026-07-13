const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const esbuild = require('esbuild');

async function buildAndZip() {
    console.log('🚀 Начинаем сборку LexiSync...');

    // 1. Очистка старой папки dist
    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true, force: true });
    }

    // 2. Сборка через esbuild
    console.log('📦 Компиляция TypeScript...');
    await esbuild.build({
        entryPoints: [
            'src/background.ts', 
            'src/content.ts', 
            'src/options.ts', 
            'src/popup.ts', 
            'src/history.ts'
        ],
        bundle: true,
        minify: true,
        outdir: 'dist',
        target: 'es2020',
    });

    // 3. Чтение версии из manifest.json
    const manifestPath = path.join(__dirname, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const zipName = `LexiSync_v${manifest.version}.zip`;

    // 4. Упаковка файлов в ZIP
    console.log(`🗜️ Создание архива: ${zipName}...`);
    const output = fs.createWriteStream(path.join(__dirname, zipName));
    const archive = archiver('zip', { zlib: { level: 9 } }); // Теперь это сработает идеально!

    output.on('close', () => {
        console.log(`✅ Сборка успешно завершена! Размер: ${(archive.pointer() / 1024).toFixed(1)} KB`);
        console.log(`🎉 Файл ${zipName} полностью готов к загрузке в Chrome Web Store.`);
    });

    archive.on('error', (err) => { throw err; });
    archive.pipe(output);

    // Добавляем только нужные файлы
    archive.directory('dist/', 'dist');
    archive.directory('icons/', 'icons');
    archive.directory('_locales/', '_locales');
    archive.file('manifest.json', { name: 'manifest.json' });
    archive.glob('*.html');

    await archive.finalize();
}

buildAndZip().catch((err) => {
    console.error('❌ Ошибка при сборке:', err);
    process.exit(1);
});