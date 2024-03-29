const filterRequest = require('../helpers/filterRequest');
const USER = require('../models/user');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');
const multerStore = multer.memoryStorage({});
const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(null, false);
  }
};
const upload = multer({
  storage: multerStore,
  fileFilter: multerFilter,
});

class Authentication {
  #generateJWTToken = (user) => {
    return jwt.sign({ user }, process.env.JWT_SECRET_KEY, {
      expiresIn: process.env.JWT_TOKEN_EXPIRES_AT,
    });
  };
  #cookieOptions = {
    maxAge: +process.env.JWT_COOKIE_EXPIRES_AT,
    httpOnly: false,
    secure: true,
    sameSite: 'none',
  };
  constructor() {
    /// AUTHENTICATION USER REGISTER METHOD
    this.userRegister = async (req, res, next) => {
      // REGISTER USER
      await USER.create(
        filterRequest(req.body, 'firstName', 'lastName', 'email', 'password')
      );
      // GET USER
      const { email } = req.body;
      const user = await USER.findOne({ email });
      // GENERATE JWT
      const jwt_token = this.#generateJWTToken(user);
      res.cookie('jwt', jwt_token, this.#cookieOptions);
      // CONTINUE
      req.jwt = jwt_token;
      req.user = user;
      next();
    };
    /// AUTHENTICATION INITIALIZE USER ACCOUNT VERIFICATION METHOD
    this.initAccountVerification = async (req, res, next) => {
      const { id } = req.user;
      const user = await USER.findById(id);
      const { otp, token } = await user.initAccontVerification();
      // CONTINUE
      req.userId = user.id;
      req.token = token;
      req.otp = otp;
      next();
    };
    /// AUTHENTICATION USER LOGIN METHOD
    this.userLogin = async (req, res) => {
      const { user } = req;
      // GENERATE JWT
      const jwt_token = this.#generateJWTToken(user);
      // SUCCESS RESPONSE
      res.cookie('jwt', jwt_token, this.#cookieOptions);
      res.status(200).json({
        status: 'success',
        msg: 'Logged in successfully ✅',
      });
    };
    /// AUTHENTICATION  USER ACCOUNT VERIFY METHOD
    this.userAccountVerify = async (req, res, next) => {
      const { id } = req.user;
      const user = await USER.findById(id).select(
        '+account_verify_otp +account_verify_token +is_account_verified +otp_expires_in -__v'
      );
      user.is_account_verified = true;
      user.account_verify_token = undefined;
      user.account_verify_otp = undefined;
      user.otp_expires_in = undefined;
      await user.save({ validateBeforeSave: false });
      // GENERATE JWT
      const jwt_token = this.#generateJWTToken(user);
      res.cookie('jwt', jwt_token, this.#cookieOptions);
      res.status(201).json({
        status: 'success',
        msg: 'Your account verified successfully ✅',
      });
    };
    /// AUTHORIZE USER
    this.authorize = async (req, res, next) => {
      const token = req.cookies['jwt'];
      let user;
      // CHECK IF NO TOKEN
      if (!token) {
        return res.status(401).json({
          status: 'error',
          msg: 'Not logged in, try log in again',
        });
      }
      // VERIFY JWT TOKEN
      if (token) {
        try {
          const valid = jwt.verify(token, process.env.JWT_SECRET_KEY);
          if (!valid) {
            return res.status(401).json({
              status: 'error',
              msg: 'Not logged in, try log in again',
            });
          }
          if (valid) {
            const id = valid.user._id;
            user = await USER.findById(id).select('+password_changed_at');
            if (!user) {
              return res.status(401).json({
                status: 'error',
                msg: 'Not logged in, try log in again',
              });
            }
            if (user) {
              if (
                user.password_changed_at &&
                Date.parse(user.password_changed_at) > valid.iat * 1000
              ) {
                return res.status(401).json({
                  status: 'error',
                  msg: 'Password had changed recently, please try login again',
                });
              }
            }
          }
        } catch (error) {
          return res.status(401).json({
            status: 'error',
            msg: 'Not logged in, try log in again',
          });
        }
      }
      user.password_changed_at = undefined;
      req.user = user;
      next();
    };
    /// AUTHORIZE TO ONLY EMAIL VERIFIED USERS
    this.restrictToVerifiedUser = (req, res, next) => {
      if (!req.user.is_account_verified) {
        return res.status(402).json({
          status: 'error',
          msg: 'You have to verify your email address to perfom this action',
        });
      }
      next();
    };
    /// AUTHENTICATION RE_INITIALIZE USER ACCOUNT VERIFICATION METHOD
    this.reAccountVerification = async (req, res, next) => {
      const { id } = req.user;
      const user = await USER.findById(id);
      const { otp, token } = await user.initAccontVerification();
      // CONTINUE
      req.userId = user.id;
      req.token = token;
      req.otp = otp;
      next();
    };
    /// AUTHENTICATION  USER FORGOT PASSWORD
    this.userForgotPassword = async (req, res, next) => {
      const { id } = req.user;
      const user = await USER.findById(id);
      const token = await user.initForgotPassword();
      // CONTINUE
      req.token = token;
      req.user = user;
      req.userId = user.id;
      next();
    };
    /// AUTHENTICATION  USER RESET PASSWORD
    this.userResetPassword = async (req, res, next) => {
      const { id } = req.user;
      const user = await USER.findById(id).select(
        '+password +reset_password_token'
      );
      user.password = req.password;
      user.reset_password_token = undefined;
      user.save({ validateBeforeSave: false });
      res.status(200).json({
        status: 'success',
        msg: 'Your password has been changed successfully',
      });
    };
    /// AUTHENTICATION USER LOGOUT METHOD
    this.userLogout = async (req, res, next) => {
      res.clearCookie('jwt', { ...this.#cookieOptions, maxAge: 0 });
      res.status(200).json({
        status: 'success',
        msg: 'Logged out successfully',
      });
    };

    /// AUTHENTICATION USER UPDATE AVATAR IMG
    this.uploadUserAvatar = upload.single('avatar');
    this.userUpdateAvatar = async (req, res, next) => {
      if (!req.file) {
        return res.status(400).json({
          status: 'error',
          msg: 'Invalid Image',
        });
      } else {
        if (req.file && req.file.size > 1024000) {
          return res.status(400).json({
            status: 'error',
            msg: 'Image size must be smaller than 1 mb',
          });
        } else {
          req.file.filename = `user-${req.user.id}-${Date.now()}.jpeg`;
          await sharp(req.file.buffer)
            .resize(128, 128)
            .toFormat('jpeg')
            .jpeg({ quality: 90 })
            .toFile(`public/img/users/${req.file.filename}`);
          const user = await USER.findById(req.user.id).select('+avatar');
          user.avatar = `${req.protocol}://${req.get('host')}/img/users/${
            req.file.filename
          }`;
          await user.save({ validateBeforeSave: false });
          res.status(200).json({
            status: 'success',
            msg: 'Your avatar photo has been updated successfuly',
          });
        }
      }
    };
    /// AUTHENTICATION GET LOGGED IN USER DATA
    this.getUserData = async (req, res) => {
      const { id } = req.user;
      const user = await USER.findById(id)
        .select('+cart')
        .select('+account_created_at')
        .select('+avatar')
        .select('+wishlist')
        .select('+orders')
        .populate('orders')
        .populate('wishlist')
        .populate('cart.items.item');
      res.status(200).json({
        data: {
          user,
        },
      });
    };
    /// UPDATE USER INFORMATION
    this.updateUserInformation = async (req, res) => {
      const { id } = req.user;
      const { firstName, lastName, email } = req.body;
      const user = await USER.findById(id);
      user.firstName = firstName || user.firstName;
      user.lastName = lastName || user.lastName;
      user.email = email || user.email;
      await user.save({ validateBeforeSave: false });
      return res.status(200).json({
        status: 'success',
        msg: 'Your information updated successfully',
      });
    };

    /// USER DELETE ACCOUNT
    this.userDeleteAccount = async (req, res) => {
      const { id } = req.user;
      const user = await USER.findById(id).select('+password').select('+cart');
      if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
        return res.status(400).json({
          status: 'error',
          msg: 'incorrect current password',
        });
      }
      if (user.cart.items_count) {
        return res.status(400).json({
          status: 'error',
          msg: 'Please clear your shopping cart first in order to delete your account',
        });
      }
      await USER.findByIdAndDelete(id);
      return res.status(200).json({
        status: 'success',
        msg: 'Account deleted successfully',
      });
    };
  }
}

module.exports = new Authentication();
