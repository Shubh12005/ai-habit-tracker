import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return null;
};

// Authoritative single administrator email from environment
const AUTHORIZED_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "shubhamnikwade2@gmail.com").trim().toLowerCase();

const requestedEmail = getArg("email");
if (requestedEmail && requestedEmail.trim().toLowerCase() !== AUTHORIZED_ADMIN_EMAIL) {
  console.error(`\n❌ SECURITY POLICY VIOLATION:`);
  console.error(`Attempt to provision unauthorized administrator account: "${requestedEmail}".`);
  console.error(`Only the single authorized administrator (${AUTHORIZED_ADMIN_EMAIL}) is permitted.`);
  process.exit(1);
}

const targetEmail = AUTHORIZED_ADMIN_EMAIL;
const password = getArg("password") || process.env.ADMIN_PASSWORD;
const name = getArg("name") || process.env.ADMIN_NAME;

const run = async () => {
  await connectDB();

  console.log(`\n--- Single Administrator Account Provisioning ---`);
  console.log(`Authoritative Admin Email: ${targetEmail}`);

  // 1. Demote any other accounts that have role "admin" to "user"
  const demoteResult = await User.updateMany(
    { email: { $ne: targetEmail }, role: "admin" },
    { $set: { role: "user" } }
  );

  if (demoteResult.modifiedCount > 0) {
    console.log(`🔒 Security enforcement: Demoted ${demoteResult.modifiedCount} unauthorized account(s) from "admin" to "user".`);
  }

  // 2. Find or create the authoritative admin user
  let user = await User.findOne({ email: targetEmail });

  if (user) {
    user.role = "admin";
    user.status = "active";
    if (password) {
      user.password = password; // Bcrypt hashed via pre-save hook in User model
    }
    if (name) {
      user.name = name;
      user.avatar = name.charAt(0).toUpperCase();
    }
    await user.save();
    console.log(`✅ Authorized account found and successfully configured as the Single Administrator.`);
  } else {
    const adminPassword = password || "Admin@123456";
    const adminName = name || "Administrator";
    user = await User.create({
      name: adminName,
      email: targetEmail,
      password: adminPassword,
      role: "admin",
      status: "active",
      avatar: adminName.charAt(0).toUpperCase(),
    });
    console.log(`✅ Authoritative Single Administrator account successfully created.`);
  }

  console.log(`Admin User ID : ${user._id}`);
  console.log(`Admin Email   : ${user.email}`);
  console.log(`Admin Role    : ${user.role}`);
  console.log(`Account Status: ${user.status}`);
  console.log(`-------------------------------------------------\n`);

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("Admin creation failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});
