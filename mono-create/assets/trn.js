(function(){
  'use strict';
  var reduce=(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)||/[?&]noanim/.test(location.search);
  // ヒーロー入場
  var hero=document.querySelector('.hero');
  if(hero){if(reduce){hero.classList.add('ready');}else{requestAnimationFrame(function(){requestAnimationFrame(function(){hero.classList.add('ready');});});}}
  // ヒーロー映像: 再生できなければ Ken Burns へフォールバック
  var hv=hero&&hero.querySelector('.herovid');
  if(hv){
    if(reduce){hero.classList.remove('has-video');}
    else{
      var p=hv.play&&hv.play();
      if(p&&p.catch){p.catch(function(){hero.classList.remove('has-video');});}
      hv.addEventListener('error',function(){hero.classList.remove('has-video');});
    }
  }
  // reveal
  var els=[].slice.call(document.querySelectorAll('[data-rv]'));
  if(reduce||!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('in');});}
  else{
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.1,rootMargin:'0px 0px -6% 0px'});
    els.forEach(function(e){io.observe(e);});
  }
  // モバイルナビ
  var t=document.querySelector('.nav-toggle'),m=document.getElementById('mnav');
  if(t&&m){
    t.addEventListener('click',function(){m.classList.add('open');document.body.style.overflow='hidden';});
    var c=m.querySelector('.mnav-close');
    function close(){m.classList.remove('open');document.body.style.overflow='';}
    if(c)c.addEventListener('click',close);
    [].slice.call(m.querySelectorAll('a')).forEach(function(a){a.addEventListener('click',close);});
  }
})();
