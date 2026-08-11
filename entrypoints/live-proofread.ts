import { startLiveProofread } from '../src/live-proofread';

export default defineUnlistedScript(() => {
    const runtime = globalThis as typeof globalThis & { __lexisyncLiveProofreadInitialized?: boolean };
    if (runtime.__lexisyncLiveProofreadInitialized) return;
    runtime.__lexisyncLiveProofreadInitialized = true;
    startLiveProofread();
});
