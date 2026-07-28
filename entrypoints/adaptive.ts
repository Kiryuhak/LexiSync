import { initializeAdaptiveSuggestions } from '../src/adaptive-suggestions';

export default defineUnlistedScript(() => {
    const runtime = globalThis as typeof globalThis & { __lexisyncAdaptiveInitialized?: boolean };
    if (runtime.__lexisyncAdaptiveInitialized) return;
    runtime.__lexisyncAdaptiveInitialized = true;
    initializeAdaptiveSuggestions();
});
