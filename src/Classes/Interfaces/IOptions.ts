export default interface Options{
    accountName: string;
    password: string;
    authCode: string;
    twoFactorCode?: string;
    refreshToken?: string;
}