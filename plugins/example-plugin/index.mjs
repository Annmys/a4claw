// Example Plugin for ClawdAgent
// Shows the basic structure for creating a plugin

export default {
  async init() {
    console.log('[example-plugin] Initialized');
  },

  async shutdown() {
    console.log('[example-plugin] Shutdown');
  },

  async executeTool(toolName, input) {
    if (toolName === 'example_hello') {
      const name = input.name || 'World';
      return { success: true, output: `Hello, ${name}! This is an example plugin.` };
    }
    return { success: false, output: '', error: `Unknown tool: ${toolName}` };
  },

  getSystemPromptFragment() {
    return 'You have access to the example-plugin which can greet users.';
  },
};
