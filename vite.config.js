export default {
    server: { proxy: { '/api': 'http://localhost:3000' } },
    build: { rollupOptions: { input: ['index.html', 'app.html', 'result.html', 'book.html'] } }
};
