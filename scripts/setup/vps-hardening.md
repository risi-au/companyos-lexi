# VPS Hardening Steps (Ubuntu 24.04)

Run these after first SSH login as root.

```bash
# 1. Update system
apt update && apt upgrade -y

# 2. Create non-root user (recommended)
adduser --disabled-password --gecos "" cosadmin
usermod -aG sudo cosadmin

# 3. Setup SSH key for new user (copy your pubkey)
mkdir -p /home/cosadmin/.ssh
cp ~/.ssh/authorized_keys /home/cosadmin/.ssh/
chown -R cosadmin:cosadmin /home/cosadmin/.ssh
chmod 700 /home/cosadmin/.ssh
chmod 600 /home/cosadmin/.ssh/authorized_keys

# 4. Disable root SSH login (edit /etc/ssh/sshd_config)
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# 5. Install basic security tools
apt install -y ufw fail2ban

ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3010/tcp   # Affine
ufw allow 5678/tcp   # n8n (restrict later with auth)
ufw --force enable

# 6. Enable fail2ban
systemctl enable fail2ban
systemctl start fail2ban

echo "Basic hardening complete. Now create /opt/cos and proceed with Docker."
```

**Next:** Switch to `cosadmin` user or continue as root for Docker install.