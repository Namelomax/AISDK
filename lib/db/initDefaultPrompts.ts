import { createPrompt } from './promts';

async function main() {
  await createPrompt({
    title: 'Default Assistant Prompt',
    content: 'Ты — полезный AI-ассистент. Помогай пользователю по мере возможности.',
    editable: false,
  });
  console.log('✅ Default prompt added');
}

main();
