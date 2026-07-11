(function(){
  'use strict';
  var reduce=(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)||/[?&]noanim/.test(location.search);
  // ヒーロー入場
  var hero=document.querySelector('.hero');
  if(hero){if(reduce){hero.classList.add('ready');}else{requestAnimationFrame(function(){requestAnimationFrame(function(){hero.classList.add('ready');});});}}
  // ヒーロー映像: 5本のストーリー映像をクロスフェードで連続再生。
  // 1本目が再生できなければ Ken Burns へフォールバック。
  var hv=hero&&hero.querySelector('.herovid');
  if(hv){
    if(reduce){hero.classList.remove('has-video');}
    else{
      var playlist=(hero.getAttribute('data-videos')||'').split(',').filter(Boolean);
      if(playlist.length<2){
        var p0=hv.play&&hv.play();
        if(p0&&p0.catch){p0.catch(function(){hero.classList.remove('has-video');});}
        hv.addEventListener('error',function(){hero.classList.remove('has-video');});
        setTimeout(function(){if(hv.currentTime===0||hv.readyState<2){hero.classList.remove('has-video');}},3000);
      }else{
        hero.classList.add('playlist');
        hv.removeAttribute('loop');hv.muted=true;
        var hvB=hv.cloneNode(false);
        hvB.removeAttribute('poster');hvB.removeAttribute('autoplay');hvB.muted=true;
        hv.parentNode.insertBefore(hvB,hv.nextSibling);
        var act=hv,stb=hvB,idx=0,started=false,switching=false;
        function setSrc(v,u){if((v.getAttribute('src')||'')!==u){v.setAttribute('src',u);v.load();}}
        function preload(){setSrc(stb,playlist[(idx+1)%playlist.length]);try{stb.pause();}catch(e){}}
        function advance(){
          if(switching)return;switching=true;
          var next=(idx+1)%playlist.length;
          setSrc(stb,playlist[next]);
          try{if(stb.readyState>0)stb.currentTime=0;}catch(e){}
          var pr=stb.play();
          function done(){
            stb.classList.add('on');act.classList.remove('on');
            try{act.pause();}catch(e){}
            var t=act;act=stb;stb=t;idx=next;switching=false;preload();
          }
          function fail(){switching=false;idx=next;setTimeout(advance,300);}
          if(pr&&pr.then){pr.then(done).catch(fail);}else{done();}
        }
        [hv,hvB].forEach(function(v){v.addEventListener('ended',function(){if(v===act)advance();});});
        setSrc(act,playlist[0]);
        var p=act.play();
        function ok(){if(!started){started=true;act.classList.add('on');preload();}}
        if(p&&p.then){p.then(ok).catch(function(){hero.classList.remove('has-video');});}else{ok();}
        act.addEventListener('error',function(){if(!started)hero.classList.remove('has-video');});
        setTimeout(function(){if(!started&&(act.currentTime===0||act.readyState<2)){hero.classList.remove('has-video');}},4000);
      }
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
