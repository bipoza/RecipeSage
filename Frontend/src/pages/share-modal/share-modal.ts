import { Component } from '@angular/core';
import { IonicPage, NavController, NavParams, ViewController, ToastController, LoadingController } from 'ionic-angular';

import { MessagingServiceProvider } from '../../providers/messaging-service/messaging-service';
import { UserServiceProvider } from '../../providers/user-service/user-service';
import { RecipeServiceProvider, Recipe } from '../../providers/recipe-service/recipe-service';

@IonicPage({
  priority: 'low'
})
@Component({
  selector: 'page-share-modal',
  templateUrl: 'share-modal.html',
})
export class ShareModalPage {
  
  recipe: Recipe;
  
  selectedThread: any;
  recipientEmail: string = '';
  recipientName: string = '';
  recipientId: string = '';
  searchingForRecipient: boolean = false;
  
  threads: any = [];
  
  autofillTimeout: any;

  constructor(
  public navCtrl: NavController,
  public navParams: NavParams,
  public toastCtrl: ToastController,
  public loadingCtrl: LoadingController,
  public messagingService: MessagingServiceProvider,
  public recipeService: RecipeServiceProvider,
  public userService: UserServiceProvider,
  public viewCtrl: ViewController) {
    this.recipe = navParams.get('recipe');
    
    this.loadThreads().then(function() {}, function() {});
  }

  ionViewDidLoad() {
    console.log('ionViewDidLoad ShareModalPage');
  }
  
  cancel() {
    this.viewCtrl.dismiss();
  }
  
  loadThreads() {
    var me = this;
    
    return new Promise(function(resolve, reject) {
      me.messagingService.threads().subscribe(function(response) {
        me.threads = response;

        resolve();
      }, function(err) {
        reject();
        
        switch(err.status) {
          case 401:
            me.navCtrl.setRoot('LoginPage', {}, {animate: true, direction: 'forward'});
            break;
          default:
            let errorToast = me.toastCtrl.create({
              message: 'An unexpected error occured. Please restart application.',
              duration: 30000
            });
            errorToast.present();
            break;
        }
      });
    });
  }
  
  selectRecipient(thread) {
    this.recipientId = thread.otherUser._id;
    console.log(this.recipientId)
    this.recipientName = '';
    this.recipientEmail = '';
  }
  
  autofillUserName() {
    this.searchingForRecipient = true;

    if (this.autofillTimeout) clearTimeout(this.autofillTimeout);
    
    var me = this;
    this.autofillTimeout = setTimeout(function() {
      me.userService.getUserByEmail(me.recipientEmail.trim()).subscribe(function(response) {
        me.recipientName = response.name || response.email;
        me.recipientId = response._id;
        me.selectedThread = null;
        me.searchingForRecipient = false;
      }, function(err) {
        me.recipientName = '';
        me.recipientId = '';
        me.selectedThread = null;
        me.searchingForRecipient = false;
      });
    }, 500);
  }
  
  send() {
    var me = this;
    
    let loading = this.loadingCtrl.create({
      content: 'Sending recipe...',
      dismissOnPageChange: true
    });
  
    loading.present();
    
    this.messagingService.create({
      to: this.recipientId,
      body: '',
      recipeId: this.recipe._id
    }).subscribe(function(response) {
      me.navCtrl.setRoot('MessageThreadPage', {
        otherUserId: me.recipientId
      }, {animate: true, direction: 'forward'});
    }, function(err) {
      switch(err.status) {
        case 401:
          me.navCtrl.setRoot('LoginPage', {}, {animate: true, direction: 'forward'});
          break;
        default:
          let errorToast = me.toastCtrl.create({
            message: 'An unexpected error occured. Please restart application.',
            duration: 30000
          });
          errorToast.present();
          break;
      }
    });
  }
}
