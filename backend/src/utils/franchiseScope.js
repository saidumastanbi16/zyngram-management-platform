function franchisesForUser(franchises, user) {
  if (["ADMIN", "HQ"].includes(user.role)) return franchises;
  if (!user.franchise_id) return [];
  const assigned = franchises.find(item =>
    item.id === user.franchise_id && item.owner_id === user.id && item.status === "ACTIVE"
  );
  if (!assigned) return [];
  const visible = new Set([user.franchise_id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const franchise of franchises) {
      if (franchise.parent_id && visible.has(franchise.parent_id) && !visible.has(franchise.id)) {
        visible.add(franchise.id);
        changed = true;
      }
    }
  }
  return franchises.filter(franchise => visible.has(franchise.id));
}

function mappingInUserScope(mapping, user) {
  if (["ADMIN", "HQ"].includes(user.role)) return true;
  const field = { COMMAND: "command", HUB: "hub", CENTER: "center" }[user.role];
  return Boolean(field && user.franchise_id && mapping?.mapped && mapping[field]?.id === user.franchise_id);
}

module.exports = { franchisesForUser, mappingInUserScope };
