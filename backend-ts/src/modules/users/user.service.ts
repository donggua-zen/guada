import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { UserRepository } from '../../common/database/user.repository';

@Injectable()
export class UserService {
  private resetPasswordFlagPath = path.join(process.cwd(), 'password_is_set.txt');

  constructor(private userRepo: UserRepository) {}

  async getProfile(userId: string) {
    return this.userRepo.findById(userId);
  }

  async updateProfile(userId: string, data: any) {
    return this.userRepo.update(userId, data);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userRepo.findById(userId);
    if (!user || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new Error('旧密码不正确');
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return this.userRepo.update(userId, { passwordHash: hashedPassword });
  }

  async createSubAccount(parentId: string, data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    return this.userRepo.create({
      ...data,
      parentId,
      role: 'subaccount',
      passwordHash: hashedPassword,
    });
  }

  async getSubAccounts(parentId: string) {
    return this.userRepo.findSubAccounts(parentId);
  }

  async deleteSubAccount(accountId: string, parentId: string) {
    const account = await this.userRepo.findById(accountId);
    if (!account || account.parentId !== parentId) {
      throw new Error('无权删除该子账户');
    }
    return this.userRepo.update(accountId, { deletedAt: new Date() }); // 软删除或根据需求物理删除
  }

  async uploadAvatar(userId: string, fileUrl: string) {
    return this.userRepo.update(userId, { avatarUrl: fileUrl });
  }

  isPasswordResetAllowed(): boolean {
    return !fs.existsSync(this.resetPasswordFlagPath);
  }

  markPasswordAsSet() {
    fs.writeFileSync(this.resetPasswordFlagPath, 'password has been set');
  }

  async resetPrimaryPassword(password: string, phone?: string, email?: string) {
    let user;
    if (phone) {
      user = await this.userRepo.findByPhone(phone);
    } else if (email) {
      user = await this.userRepo.findByEmail(email);
    }

    if (!user) {
      throw new Error('用户不存在');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    return this.userRepo.update(user.id, { passwordHash: hashedPassword });
  }
}
