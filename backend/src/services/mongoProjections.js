function getMongoProjections(data) {
  const users = Array.isArray(data.Users) ? data.Users : [];
  const accounts = Array.isArray(data.AuthAccounts) ? data.AuthAccounts : [];
  const franchises = Array.isArray(data.Franchises) ? data.Franchises : [];

  const customers = users
    .filter(user => user.role === "CUSTOMER")
    .map(user => ({
      id: user.id,
      user_id: user.id,
      ...(user.name === undefined ? {} : { name: user.name }),
      ...(user.email === undefined ? {} : { email: user.email }),
      ...(user.mobile === undefined ? {} : { mobile: user.mobile }),
      ...(user.status === undefined ? {} : { status: user.status }),
      ...(user.created_at === undefined ? {} : { created_at: user.created_at })
    }));

  const ownersById = new Map();
  for (const franchise of franchises) {
    if (typeof franchise.owner_id !== "string" || !franchise.owner_id.trim()) continue;
    const ownerId = franchise.owner_id.trim();
    const owner = ownersById.get(ownerId) || {
      id: ownerId,
      user_id: null,
      name: null,
      email: null,
      mobile: null,
      account_role: null,
      linkage_status: "UNLINKED",
      franchise_ids: [],
      franchise_levels: []
    };
    const user = users.find(item => item.id === ownerId);
    const account = accounts.find(item => item.user_id === ownerId);
    if (user) {
      owner.user_id = user.id;
      owner.name = user.name || owner.name;
      owner.email = user.email || owner.email;
      owner.mobile = user.mobile || owner.mobile;
      owner.account_role = user.role || owner.account_role;
      owner.linkage_status = "LINKED";
    } else if (account) {
      owner.user_id = account.user_id;
      owner.email = account.email || owner.email;
      owner.account_role = account.role || owner.account_role;
      owner.linkage_status = "LINKED";
    }
    if (!owner.franchise_ids.includes(franchise.id)) owner.franchise_ids.push(franchise.id);
    if (!owner.franchise_levels.includes(franchise.level)) owner.franchise_levels.push(franchise.level);
    ownersById.set(ownerId, owner);
  }

  const franchiseOwners = [...ownersById.values()].map(owner => ({
    ...owner,
    franchise_ids: owner.franchise_ids.sort(),
    franchise_levels: owner.franchise_levels.sort()
  }));

  return { Customers: customers, FranchiseOwners: franchiseOwners };
}

module.exports = { getMongoProjections };
