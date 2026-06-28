import prisma from "../dbConnection";

export function sortUsers(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function getOrCreateConversation(currentUserId: string, peerUserId: string) {
  const [userA, userB] = sortUsers(currentUserId, peerUserId);

  const existing = await prisma.direct_conversation.findUnique({
    where: {
      user_a_id_user_b_id: {
        user_a_id: userA,
        user_b_id: userB,
      },
    },
  });

  if (existing) return existing;

  return prisma.direct_conversation.create({
    data: {
      user_a_id: userA,
      user_b_id: userB,
    },
  });
}
