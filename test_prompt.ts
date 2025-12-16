
import { getPromptById, getPrompt } from './lib/getPromt';

async function test() {
  try {
    console.log('Testing getPromptById...');
    // Try to fetch a prompt that likely exists or check default
    const defaultPrompt = await getPrompt();
    console.log('Default prompt:', defaultPrompt.slice(0, 50));
    
    // If we had a specific ID from the logs, we could test it.
    // Since we don't have the exact ID of the user's prompt from the logs (it wasn't printed),
    // we can't test the specific failure case directly without more info.
    // But we can check if getPromptById works for a known ID.
    
  } catch (e) {
    console.error(e);
  }
}

test();
