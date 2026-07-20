/* Seed a conversation containing a unique searchable term; prints its id. */
import { addMessage, createConversation } from "../lib/db";

const conv = createConversation("test/model");
addMessage(conv.id, "user", "tell me about the quetzalcoatl feathered serpent");
addMessage(conv.id, "assistant", "Quetzalcoatl was a Mesoamerican deity.");
console.log(conv.id);
