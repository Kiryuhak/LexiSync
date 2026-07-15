import '../src/content';

export default defineContentScript({
    matches: ['<all_urls>'],
    main() {
        // Логика content script регистрируется в src/content.ts.
    },
});
